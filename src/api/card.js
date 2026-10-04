// Tarjeta digital del consultorio (/<slug>): foto de perfil, bio, dirección, mapa, horario y enlaces.
import { json, readJson, HttpError, str } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { businessBySlug, isValidSlug } from '../lib/tenant.js';

const MAX_LOGO = 3 * 1024 * 1024;
const LOGO_TYPES = /^image\/(png|jpeg|webp)$/;

export const parseCard = (s) => {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
};
export const logoUrl = (slug, key) => (key ? `/api/public/negocio/${slug}/logo?v=${key.slice(-12)}` : null);

function coord(v, max, label) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new HttpError(400, `${label} inválida`);
  return Math.round(n * 1e6) / 1e6;
}

function linksField(raw) {
  const links = Array.isArray(raw) ? raw : [];
  if (links.length > 8) throw new HttpError(400, 'Máximo 8 enlaces');
  return links.map((l) => {
    const label = str(l.label, { required: true, max: 40, label: 'Nombre del enlace' });
    const url = str(l.url, { required: true, max: 300, label: 'Enlace' });
    // Solo http(s): evita enlaces javascript: u otros esquemas en una página pública.
    let u;
    try { u = new URL(url); } catch { throw new HttpError(400, `"${label}": el enlace no es válido`); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, `"${label}": el enlace debe empezar con https://`);
    return { label, url: u.href };
  });
}

export function cardFields(body) {
  const lat = coord(body.lat, 90, 'Latitud'), lng = coord(body.lng, 180, 'Longitud');
  return {
    specialty: str(body.specialty, { max: 80, label: 'Especialidad' }),
    bio: str(body.bio, { max: 500, label: 'Descripción' }),
    address: str(body.address, { max: 200, label: 'Dirección' }),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    showMap: !!body.showMap,
    hours: str(body.hours, { max: 120, label: 'Horario' }),
    links: linksField(body.links),
  };
}

// ---------- tarjeta por profesional (/<slug>/<handle>) ----------

// Palabras que no pueden ser el handle de un profesional (chocan con rutas del consultorio).
const RESERVED_HANDLES = new Set(['admin', 'p', 'api', 'logo', 'sw.js', 'manifest.webmanifest', 'equipo', 'tarjeta', 'cv']);
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const isValidHandle = (h) => HANDLE_RE.test(h) && !RESERVED_HANDLES.has(h);
const slugify = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const memberPhotoUrl = (slug, handle, key) => (key ? `/api/public/negocio/${slug}/${handle}/foto?v=${key.slice(-12)}` : null);

function memberFields(body) {
  const lat = coord(body.lat, 90, 'Latitud'), lng = coord(body.lng, 180, 'Longitud');
  const phone = str(body.phone, { max: 30, label: 'WhatsApp' });
  const mail = str(body.email, { max: 254, label: 'Correo' });
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpError(400, 'El correo no es válido');
  return {
    displayName: str(body.displayName, { max: 80, label: 'Nombre' }),
    specialty: str(body.specialty, { max: 80, label: 'Especialidad' }),
    bio: str(body.bio, { max: 500, label: 'Descripción' }),
    phone, email: mail ? mail.toLowerCase() : null,
    // Opcionales: si quedan vacíos se usan los del consultorio.
    address: str(body.address, { max: 200, label: 'Dirección' }),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    showMap: !!body.showMap,
    hours: str(body.hours, { max: 120, label: 'Horario' }),
    links: linksField(body.links),
  };
}

// Membresía de un miembro del equipo ('me' = quien está en sesión); le asigna un handle si no tiene.
// Cada quien edita su tarjeta; propietarios y administradores, la de cualquiera del equipo.
async function membershipOf(c, who = 'me') {
  const uid = who === 'me' ? c.user.id : who;
  if (uid !== c.user.id && !['owner', 'admin'].includes(c.role)) throw new HttpError(403, 'Solo puedes editar tu propia tarjeta');
  const db = tenantDb(c);
  const m = await db.first(
    `SELECT m.handle, m.photo_key, m.card, m.role, u.name, u.email, b.slug
       FROM memberships m JOIN users u ON u.id = m.user_id JOIN businesses b ON b.id = m.business_id
      WHERE m.business_id = ? AND m.user_id = ?`,
    c.businessId, uid,
  );
  if (!m) throw new HttpError(404, 'Esa persona no pertenece a este consultorio');
  m.user_id = uid;
  if (!m.handle) {
    const base = slugify(m.name || m.email.split('@')[0]) || 'profesional';
    for (let i = 0; i < 50 && !m.handle; i++) {
      const h = (i ? `${base}-${i + 1}` : base).replace(/^-+/, '');
      if (!isValidHandle(h)) continue;
      if (await db.first('SELECT 1 FROM memberships WHERE business_id = ? AND handle = ?', c.businessId, h)) continue;
      await db.run('UPDATE memberships SET handle = ? WHERE business_id = ? AND user_id = ?', h, c.businessId, uid);
      m.handle = h;
    }
  }
  return m;
}

export function routes(r) {
  r.get('/api/admin/card', 'tenant', async (c) => {
    const b = await tenantDb(c).first(
      'SELECT name, slug, phone, email, logo_key, card FROM businesses WHERE id = ? /* business_id */', c.businessId,
    );
    return json({ name: b.name, slug: b.slug, phone: b.phone, email: b.email, logo: logoUrl(b.slug, b.logo_key), card: parseCard(b.card) });
  });

  // Tarjeta del negocio (Datos del negocio): nombre, contacto, dirección, mapa, horario y redes.
  // Diwilo Web también puede editarla (api/platform.js); la dirección web /<slug> solo desde allá.
  r.put('/api/admin/card', 'manager', async (c) => {
    const body = await readJson(c.req);
    const card = cardFields(body.card || {});
    const mail = str(body.email, { max: 254, label: 'Correo' });
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpError(400, 'El correo no es válido');
    await tenantDb(c).run(
      `UPDATE businesses SET name = ?, phone = ?, email = ?, card = ?, updated_at = datetime('now') WHERE id = ? /* business_id */`,
      str(body.name, { required: true, max: 120, label: 'Nombre del negocio' }),
      str(body.phone, { max: 30, label: 'Teléfono' }),
      mail ? mail.toLowerCase() : null,
      JSON.stringify(card), c.businessId,
    );
    return json({ ok: true, card });
  });

  r.post('/api/admin/card/logo', 'manager', async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Adjunta una imagen');
    if (!LOGO_TYPES.test(file.type)) throw new HttpError(415, 'La foto debe ser PNG, JPG o WebP');
    if (file.size > MAX_LOGO) throw new HttpError(413, 'La foto supera 3 MB');
    const db = tenantDb(c);
    const prev = await db.first('SELECT slug, logo_key FROM businesses WHERE id = ? /* business_id */', c.businessId);
    const key = `${c.businessId}/brand/${uuid()}`;
    await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    await db.run(`UPDATE businesses SET logo_key = ?, updated_at = datetime('now') WHERE id = ? /* business_id */`, key, c.businessId);
    if (prev.logo_key) c.ctx.waitUntil(c.env.FILES.delete(prev.logo_key));
    return json({ ok: true, logo: logoUrl(prev.slug, key) }, 201);
  });

  r.delete('/api/admin/card/logo', 'manager', async (c) => {
    const db = tenantDb(c);
    const prev = await db.first('SELECT logo_key FROM businesses WHERE id = ? /* business_id */', c.businessId);
    await db.run(`UPDATE businesses SET logo_key = NULL WHERE id = ? /* business_id */`, c.businessId);
    if (prev.logo_key) c.ctx.waitUntil(c.env.FILES.delete(prev.logo_key));
    return json({ ok: true });
  });

  // ---------- tarjeta de cada miembro del equipo (/team/:userId/card, 'me' = la propia) ----------

  const getMember = async (c) => {
    const m = await membershipOf(c, c.params.userId);
    return json({ userId: m.user_id, handle: m.handle, slug: m.slug, name: m.name, email: m.email, role: m.role,
      photo: memberPhotoUrl(m.slug, m.handle, m.photo_key), card: parseCard(m.card) });
  };
  const putMember = async (c) => {
    const body = await readJson(c.req);
    const m = await membershipOf(c, c.params.userId);
    const card = memberFields(body.card || {});
    let handle = m.handle;
    if (body.handle !== undefined && body.handle !== m.handle) {
      handle = String(body.handle || '').trim().toLowerCase();
      if (!isValidHandle(handle)) throw new HttpError(400, 'La dirección de la tarjeta solo puede tener minúsculas, números y guiones');
      if (await tenantDb(c).first('SELECT 1 FROM memberships WHERE business_id = ? AND handle = ? AND user_id <> ?', c.businessId, handle, m.user_id)) {
        throw new HttpError(409, 'Esa dirección ya la usa otra persona del equipo');
      }
    }
    await tenantDb(c).run(
      'UPDATE memberships SET card = ?, handle = ? WHERE business_id = ? AND user_id = ?',
      JSON.stringify(card), handle, c.businessId, m.user_id,
    );
    return json({ ok: true, card, handle });
  };
  const postPhoto = async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Adjunta una imagen');
    if (!LOGO_TYPES.test(file.type)) throw new HttpError(415, 'La foto debe ser PNG, JPG o WebP');
    if (file.size > MAX_LOGO) throw new HttpError(413, 'La foto supera 3 MB');
    const m = await membershipOf(c, c.params.userId);
    const key = `${c.businessId}/team/${m.user_id}/${uuid()}`;
    await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    await tenantDb(c).run('UPDATE memberships SET photo_key = ? WHERE business_id = ? AND user_id = ?', key, c.businessId, m.user_id);
    if (m.photo_key) c.ctx.waitUntil(c.env.FILES.delete(m.photo_key));
    return json({ ok: true, photo: memberPhotoUrl(m.slug, m.handle, key) }, 201);
  };
  const deletePhoto = async (c) => {
    const m = await membershipOf(c, c.params.userId);
    await tenantDb(c).run('UPDATE memberships SET photo_key = NULL WHERE business_id = ? AND user_id = ?', c.businessId, m.user_id);
    if (m.photo_key) c.ctx.waitUntil(c.env.FILES.delete(m.photo_key));
    return json({ ok: true });
  };
  for (const base of ['/api/admin/team/:userId/card', '/api/admin/card/:userId']) {
    r.get(base, 'tenant', getMember);
    r.put(base, 'tenant', putMember);
    r.post(`${base}/photo`, 'tenant', postPhoto);
    r.delete(`${base}/photo`, 'tenant', deletePhoto);
  }

  // ---------- público ----------

  r.get('/api/public/negocio/:slug/logo', 'public', async (c) => {
    const b = isValidSlug(c.params.slug) && (await businessBySlug(c.env, c.params.slug));
    const obj = b?.logo_key && (await c.env.FILES.get(b.logo_key));
    if (!obj) return Response.redirect(`${c.url.origin}/cv/icon-512.png`, 302);
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType || 'image/png',
        // La URL lleva ?v=<clave>: al cambiar la foto cambia la URL, así que se puede cachear largo.
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  });

  // Tarjeta de un profesional: sus datos + dirección, mapa y horario del consultorio.
  r.get('/api/public/negocio/:slug/:handle', 'public', async (c) => {
    const data = await memberCardData(c.env, c.params.slug, c.params.handle);
    if (!data) throw new HttpError(404, 'Tarjeta no encontrada');
    return json(data);
  });

  r.get('/api/public/negocio/:slug/:handle/foto', 'public', async (c) => {
    const m = await memberRow(c.env, c.params.slug, c.params.handle);
    const obj = m?.photo_key && (await c.env.FILES.get(m.photo_key));
    if (!obj) return Response.redirect(`${c.url.origin}/cv/icon-512.png`, 302);
    return new Response(obj.body, {
      headers: { 'content-type': obj.httpMetadata?.contentType || 'image/png', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
    });
  });


}

// ---------- datos públicos de la tarjeta de un profesional ----------

export async function memberRow(env, slug, handle) {
  if (!isValidSlug(slug) || !isValidHandle(handle)) return null;
  return env.DB.prepare(
    `SELECT m.handle, m.photo_key, m.card AS member_card, u.name AS user_name,
            b.name AS business_name, b.slug, b.phone AS business_phone, b.email AS business_email, b.logo_key, b.card AS business_card, b.status
       FROM memberships m JOIN users u ON u.id = m.user_id JOIN businesses b ON b.id = m.business_id
      WHERE b.slug = ? AND m.handle = ?`,
  ).bind(slug, handle).first();
}

export async function memberCardData(env, slug, handle) {
  const m = await memberRow(env, slug, handle);
  if (!m || m.status !== 'active') return null;
  const mine = parseCard(m.member_card), biz = parseCard(m.business_card);
  return {
    name: mine.displayName || m.user_name || m.business_name,
    org: m.business_name,
    slug: m.slug,
    path: `${m.slug}/${m.handle}`,
    logo: memberPhotoUrl(m.slug, m.handle, m.photo_key),
    phone: mine.phone || m.business_phone,
    email: mine.email || null,
    card: {
      specialty: mine.specialty, bio: mine.bio,
      // Dónde atiende y en qué horario: lo suyo, o lo del consultorio si no lo puso.
      ...(mine.address || mine.lat != null
        ? { address: mine.address, lat: mine.lat, lng: mine.lng, showMap: mine.showMap }
        : { address: biz.address, lat: biz.lat, lng: biz.lng, showMap: biz.showMap }),
      hours: mine.hours || biz.hours,
      links: mine.links?.length ? mine.links : biz.links || [],
    },
  };
}
