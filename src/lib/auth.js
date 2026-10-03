// Seguridad en dos capas:
//   1. Cloudflare Access (SSO / código por correo) entrega la identidad (email)
//      en un JWT firmado que verificamos aquí.
//   2. PIN propio del usuario -> sesión en D1 referenciada por cookie HttpOnly.
// La sesión también fija el negocio (tenant) activo.

import { HttpError, getCookie } from './http.js';
import { globalDb, uuid, nowIso } from './db.js';

export const SESSION_COOKIE = 'cdn_sid';
const SESSION_HOURS = 12;
const MAX_PIN_FAILS = 5;
const LOCK_MINUTES = 15;
const PBKDF2_ITERATIONS = 100000;

const enc = new TextEncoder();

// ---------- utilidades cripto ----------

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

function b64urlDecode(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (ch) => ch.charCodeAt(0));
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPin(pin, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(bits), salt: saltHex };
}

// ---------- Cloudflare Access ----------

let certCache = { keys: null, at: 0 };

async function accessKeys(env) {
  if (certCache.keys && Date.now() - certCache.at < 60 * 60 * 1000) return certCache.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, 'No se pudo validar Cloudflare Access');
  const { keys } = await res.json();
  certCache = { keys, at: Date.now() };
  return keys;
}

async function verifyAccessJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(403, 'Token de Access inválido');
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (header.alg !== 'RS256') throw new HttpError(403, 'Token de Access inválido');

  const jwk = (await accessKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) {
    certCache = { keys: null, at: 0 }; // rotación de llaves: forzar recarga la próxima vez
    throw new HttpError(403, 'Token de Access inválido');
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new HttpError(403, 'Firma de Access inválida');

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new HttpError(403, 'Audiencia de Access inválida');
  // La firma ya se validó con las llaves del equipo y el AUD es único por app.
  // El emisor puede conservar el nombre anterior del equipo tras renombrarlo,
  // así que solo exigimos que sea un dominio de Cloudflare Access.
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(payload.iss || '')) {
    throw new HttpError(403, `Emisor de Access inválido (${String(payload.iss).slice(0, 80)})`);
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new HttpError(403, 'Sesión de Access expirada');
  if (!payload.email) throw new HttpError(403, 'Access no entregó un correo');
  return payload.email.toLowerCase();
}

// Devuelve el email autenticado por Access.
// En local (sin ACCESS_AUD) usa DEV_EMAIL de .dev.vars.
export async function accessEmail(req, env) {
  if (env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN) {
    const token = req.headers.get('cf-access-jwt-assertion') || getCookie(req, 'CF_Authorization');
    if (!token) throw new HttpError(403, 'Se requiere Cloudflare Access', 'NO_ACCESS');
    return verifyAccessJwt(token, env);
  }
  if (env.DEV_EMAIL) return env.DEV_EMAIL.toLowerCase();
  throw new HttpError(503, 'Cloudflare Access no está configurado (ACCESS_TEAM_DOMAIN / ACCESS_AUD)');
}

// ---------- usuarios ----------

function superadminList(env) {
  return (env.SUPERADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Busca el usuario por email. Si está en SUPERADMIN_EMAILS y no existe, lo crea.
export async function loadUser(env, email) {
  const db = globalDb(env);
  let user = await db.first('SELECT * FROM users WHERE email = ?', email);
  const isSuper = superadminList(env).includes(email);
  if (!user && isSuper) {
    await db.run('INSERT INTO users (id, email, is_superadmin) VALUES (?, ?, 1)', uuid(), email);
    user = await db.first('SELECT * FROM users WHERE email = ?', email);
  } else if (user && isSuper && !user.is_superadmin) {
    await db.run('UPDATE users SET is_superadmin = 1 WHERE id = ?', user.id);
    user.is_superadmin = 1;
  }
  if (!user) throw new HttpError(403, 'Tu correo no tiene acceso a ningún negocio', 'NO_USER');
  return user;
}

export async function userBusinesses(env, user) {
  const db = globalDb(env);
  if (user.is_superadmin) {
    return db.all(
      `SELECT b.id, b.name, b.status, COALESCE(m.role, 'owner') AS role
         FROM businesses b LEFT JOIN memberships m ON m.business_id = b.id AND m.user_id = ?
        ORDER BY b.name`,
      user.id,
    );
  }
  return db.all(
    `SELECT b.id, b.name, b.status, m.role
       FROM memberships m JOIN businesses b ON b.id = m.business_id
      WHERE m.user_id = ? AND b.status = 'active'
      ORDER BY b.name`,
    user.id,
  );
}

// ---------- PIN ----------

export async function checkPin(env, user, pin) {
  const db = globalDb(env);
  if (user.locked_until && user.locked_until > nowIso()) {
    throw new HttpError(429, 'Demasiados intentos. Intenta de nuevo en unos minutos.', 'LOCKED');
  }
  const { hash } = await hashPin(pin, user.pin_salt);
  if (timingSafeEqualHex(hash, user.pin_hash)) {
    if (user.failed_pins) await db.run('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?', user.id);
    return;
  }
  const fails = (user.failed_pins || 0) + 1;
  const lock = fails >= MAX_PIN_FAILS ? isoIn(LOCK_MINUTES * 60 * 1000) : null;
  await db.run('UPDATE users SET failed_pins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, user.id);
  throw new HttpError(401, lock ? 'PIN incorrecto. Cuenta bloqueada 15 minutos.' : 'PIN incorrecto', 'BAD_PIN');
}

export async function setPin(env, userId, pin) {
  if (!/^\d{4,8}$/.test(pin || '')) throw new HttpError(400, 'El PIN debe tener entre 4 y 8 dígitos');
  const { hash, salt } = await hashPin(pin);
  await globalDb(env).run(
    'UPDATE users SET pin_hash = ?, pin_salt = ?, failed_pins = 0, locked_until = NULL WHERE id = ?',
    hash, salt, userId,
  );
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
export async function loadSession(req, env, email) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await globalDb(env).first(
    `SELECT s.id AS session_id, s.business_id, s.email AS session_email,
            u.id AS user_id, u.email, u.name, u.is_superadmin,
            m.role, b.name AS business_name, b.status AS business_status, b.timezone
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = u.id AND m.business_id = s.business_id
       LEFT JOIN businesses b ON b.id = s.business_id
      WHERE s.id = ? AND s.expires_at > ?`,
    await sha256Hex(token), nowIso(),
  );
  // La sesión queda atada al correo de Access con el que se creó.
  if (!row || row.session_email !== email || row.email !== email) return null;
  if (row.is_superadmin && row.business_id && !row.role) row.role = 'owner';
  return row;
}

export async function destroySession(env, sessionId) {
  await globalDb(env).run('DELETE FROM sessions WHERE id = ?', sessionId);
}

// ---------- niveles de autorización por ruta ----------
//   'access'  : identidad de Access + usuario registrado
//   'session' : + PIN validado (sesión vigente)
//   'tenant'  : + negocio activo con membresía
//   'manager' : + rol owner/admin en el negocio
//   'super'   : + superadministrador de la plataforma

export async function authenticate(c, level) {
  c.email = await accessEmail(c.req, c.env);
  if (level === 'access') {
    c.user = await loadUser(c.env, c.email);
    return;
  }
  const s = await loadSession(c.req, c.env, c.email);
  if (!s) throw new HttpError(401, 'Ingresa tu PIN', 'NO_SESSION');
  c.session = s;
  c.user = { id: s.user_id, email: s.email, name: s.name, is_superadmin: !!s.is_superadmin };

  if (level === 'session') return;
  if (level === 'super') {
    if (!s.is_superadmin) throw new HttpError(403, 'Solo superadministradores');
    return;
  }
  if (!s.business_id || !s.role) throw new HttpError(409, 'Selecciona un negocio', 'NO_BUSINESS');
  if (s.business_status !== 'active' && !s.is_superadmin) throw new HttpError(403, 'Negocio suspendido');
  c.businessId = s.business_id;
  c.role = s.role;
  c.timezone = s.timezone || 'America/Bogota';
  if (level === 'manager' && !['owner', 'admin'].includes(s.role)) {
    throw new HttpError(403, 'Requiere rol de administrador del negocio');
  }
}
