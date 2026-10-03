// Ingreso con correo + contraseña -> sesión en D1 referenciada por cookie HttpOnly.
// La sesión también fija el negocio (tenant) activo.
// Los negocios, sus propietarios y la suscripción los maneja Diwilo Web
// (api/platform.js, nivel 'platform' con PLATFORM_KEY).
// La contraseña vive en users.pin_hash/pin_salt (antes era un PIN; los PIN
// viejos se aceptan una vez y obligan a crear la contraseña).

import { HttpError, getCookie } from './http.js';
import { globalDb, nowIso } from './db.js';

export const SESSION_COOKIE = 'cdn_sid';
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const PBKDF2_ITERATIONS = 100000;
const MIN_PASSWORD = 8;

const enc = new TextEncoder();

// ---------- utilidades cripto ----------

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(bits), salt: saltHex };
}

// ---------- usuarios ----------

export async function userByEmail(env, email) {
  return globalDb(env).first('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
}

export async function userBusinesses(env, user) {
  return globalDb(env).all(
    `SELECT b.id, b.name, b.status, m.role
       FROM memberships m JOIN businesses b ON b.id = m.business_id
      WHERE m.user_id = ? AND b.status = 'active'
      ORDER BY b.name`,
    user.id,
  );
}

// ---------- contraseña ----------

// Lanza 401/429 si no coincide. Mismo mensaje para correo inexistente o clave mala.
export async function checkPassword(env, user, password) {
  const bad = new HttpError(401, 'Correo o contraseña incorrectos', 'BAD_LOGIN');
  if (!user || !user.pin_hash) {
    await hashPassword(String(password || '')); // mismo costo que un intento real
    throw bad;
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    throw new HttpError(429, 'Demasiados intentos. Intenta de nuevo en unos minutos.', 'LOCKED');
  }
  const { hash } = await hashPassword(String(password || ''), user.pin_salt);
  if (timingSafeEqualHex(hash, user.pin_hash)) {
    if (user.failed_pins) await globalDb(env).run('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?', user.id);
    return;
  }
  const fails = (user.failed_pins || 0) + 1;
  const lock = fails >= MAX_FAILS ? isoIn(LOCK_MINUTES * 60 * 1000) : null;
  await globalDb(env).run('UPDATE users SET failed_pins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, user.id);
  if (lock) throw new HttpError(401, 'Contraseña incorrecta. Cuenta bloqueada 15 minutos.', 'BAD_LOGIN');
  throw bad;
}

export const isWeakPassword = (password) => String(password || '').length < MIN_PASSWORD;

export async function setPassword(env, userId, password) {
  if (isWeakPassword(password) || String(password).length > 200) {
    throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  }
  const { hash, salt } = await hashPassword(String(password));
  await globalDb(env).run(
    'UPDATE users SET pin_hash = ?, pin_salt = ?, failed_pins = 0, locked_until = NULL, invite_hash = NULL WHERE id = ?',
    hash, salt, userId,
  );
}

// ---------- invitaciones ----------
// Link /admin/login#invite=<token> para crear (o restablecer) la contraseña.
// Se guarda solo el SHA-256; generar uno nuevo invalida el anterior.

export const invitePath = (token) => `/admin/login#invite=${token}`;

export async function createInvite(env, userId) {
  const token = randomHex(32);
  await globalDb(env).run('UPDATE users SET invite_hash = ? WHERE id = ?', await sha256Hex(token), userId);
  return token;
}

export async function userByInvite(env, token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return null;
  return globalDb(env).first('SELECT * FROM users WHERE invite_hash = ?', await sha256Hex(token));
}

// ---------- sesiones ----------

const isoIn = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

export async function createSession(env, user, businessId) {
  const token = randomHex(32);
  await globalDb(env).run(
    'INSERT INTO sessions (id, user_id, email, business_id, expires_at) VALUES (?, ?, ?, ?, ?)',
    await sha256Hex(token), user.id, user.email, businessId, isoIn(SESSION_HOURS * 3600 * 1000),
  );
  return token;
}

export function sessionCookie(token, req) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  const maxAge = token ? SESSION_HOURS * 3600 : 0;
  return `${SESSION_COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Carga sesión + usuario + rol en el negocio activo en una sola consulta.
export async function loadSession(req, env) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await globalDb(env).first(
    `SELECT s.id AS session_id, s.business_id,
            u.id AS user_id, u.email, u.name,
            m.role, b.name AS business_name, b.status AS business_status, b.timezone, b.paid_until
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = u.id AND m.business_id = s.business_id
       LEFT JOIN businesses b ON b.id = s.business_id
      WHERE s.id = ? AND s.expires_at > ?`,
    await sha256Hex(token), nowIso(),
  );
  if (!row) return null;
  row.read_only = isExpired(row.paid_until);
  return row;
}

export async function destroySession(env, sessionId) {
  await globalDb(env).run('DELETE FROM sessions WHERE id = ?', sessionId);
}

// ---------- suscripción ----------
// businesses.paid_until ('YYYY-MM-DD', inclusive) lo fija Diwilo Web. NULL = sin límite.
// Vencida -> solo lectura: toda escritura del negocio responde 402.

const todayBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
export const isExpired = (paidUntil) => !!paidUntil && paidUntil < todayBogota();

function assertWritable(c, paidUntil) {
  if (c.req.method !== 'GET' && isExpired(paidUntil)) {
    throw new HttpError(402, 'La suscripción del negocio está vencida: solo lectura.', 'READ_ONLY');
  }
}

// ---------- niveles de autorización por ruta ----------
//   'public'   : sin sesión (login, invitaciones)
//   'session'  : sesión vigente (correo + contraseña)
//   'tenant'   : + negocio activo con membresía
//   'manager'  : + rol owner/admin en el negocio
//   'portal'   : paciente con enlace privado
//   'platform' : Diwilo Web (Authorization: Bearer PLATFORM_KEY)

// Paciente con enlace privado: no pasa por login; el token (256 bits) es la credencial.
async function authenticatePortal(c) {
  const token = c.req.headers.get('x-portal-token') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, 'Enlace inválido', 'BAD_LINK');
  const id = await sha256Hex(token);
  const row = await globalDb(c.env).first(
    `SELECT l.business_id, l.patient_id, b.timezone, b.paid_until, b.status AS business_status, p.status AS patient_status
       FROM portal_links l
       JOIN businesses b ON b.id = l.business_id
       JOIN patients p ON p.id = l.patient_id AND p.business_id = l.business_id
      WHERE l.id = ? AND l.revoked_at IS NULL`,
    id,
  );
  if (!row) throw new HttpError(401, 'Este enlace ya no es válido. Pide uno nuevo a tu nutricionista.', 'BAD_LINK');
  if (row.business_status !== 'active' || row.patient_status !== 'active') throw new HttpError(403, 'Acceso no disponible');
  assertWritable(c, row.paid_until);
  c.businessId = row.business_id;
  c.patientId = row.patient_id;
  c.timezone = row.timezone || 'America/Bogota';
  c.ctx?.waitUntil(globalDb(c.env).run(`UPDATE portal_links SET last_used_at = datetime('now') WHERE id = ?`, id));
}

async function authenticatePlatform(c) {
  const key = c.env.PLATFORM_KEY;
  const auth = c.req.headers.get('authorization') || '';
  if (!key || !timingSafeEqualHex(await sha256Hex(auth), await sha256Hex(`Bearer ${key}`))) {
    throw new HttpError(401, 'No autorizado');
  }
}

export async function authenticate(c, level) {
  if (level === 'public') return;
  if (level === 'portal') return authenticatePortal(c);
  if (level === 'platform') return authenticatePlatform(c);
  const s = await loadSession(c.req, c.env);
  if (!s) throw new HttpError(401, 'Inicia sesión', 'NO_SESSION');
  c.session = s;
  c.user = { id: s.user_id, email: s.email, name: s.name };

  if (level === 'session') return;
  if (!s.business_id || !s.role) throw new HttpError(409, 'Selecciona un negocio', 'NO_BUSINESS');
  if (s.business_status !== 'active') throw new HttpError(403, 'Negocio suspendido');
  assertWritable(c, s.paid_until);
  c.businessId = s.business_id;
  c.role = s.role;
  c.timezone = s.timezone || 'America/Bogota';
  if (level === 'manager' && !['owner', 'admin'].includes(s.role)) {
    throw new HttpError(403, 'Requiere rol de administrador del negocio');
  }
}
