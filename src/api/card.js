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

function cardFields(body) {
  const links = Array.isArray(body.links) ? body.links : [];
  if (links.length > 8) throw new HttpError(400, 'Máximo 8 enlaces');
  const lat = coord(body.lat, 90, 'Latitud'), lng = coord(body.lng, 180, 'Longitud');
  return {
    specialty: str(body.specialty, { max: 80, label: 'Especialidad' }),
    bio: str(body.bio, { max: 500, label: 'Descripción' }),
    address: str(body.address, { max: 200, label: 'Dirección' }),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    showMap: !!body.showMap,
    hours: str(body.hours, { max: 120, label: 'Horario' }),
    links: links.map((l) => {
      const label = str(l.label, { required: true, max: 40, label: 'Nombre del enlace' });
      const url = str(l.url, { required: true, max: 300, label: 'Enlace' });
      // Solo http(s): evita enlaces javascript: u otros esquemas en una página pública.
      let u;
      try { u = new URL(url); } catch { throw new HttpError(400, `"${label}": el enlace no es válido`); }
      if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, `"${label}": el enlace debe empezar con https://`);
      return { label, url: u.href };
    }),
  };
}

export function routes(r) {
  r.get('/api/admin/card', 'tenant', async (c) => {
    const b = await tenantDb(c).first(
      'SELECT name, slug, phone, email, logo_key, card FROM businesses WHERE id = ? /* business_id */', c.businessId,
    );
    return json({ name: b.name, slug: b.slug, phone: b.phone, email: b.email, logo: logoUrl(b.slug, b.logo_key), card: parseCard(b.card) });
  });

  r.put('/api/admin/card', 'manager', async (c) => {
    const card = cardFields((await readJson(c.req)).card || {});
    await tenantDb(c).run(
      `UPDATE businesses SET card = ?, updated_at = datetime('now') WHERE id = ? /* business_id */`,
      JSON.stringify(card), c.businessId,
    );
    return json({ ok: true, card });
  });

  // Foto de perfil: llega ya recortada en cuadrado desde el navegador.
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
}
