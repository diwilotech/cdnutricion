// Datos públicos de un consultorio para su página /<slug> y su login (sin sesión).
import { json, HttpError } from '../lib/http.js';
import { businessBySlug, isValidSlug } from '../lib/tenant.js';

export function routes(r) {
  r.get('/api/public/negocio/:slug', 'public', async (c) => {
    const b = isValidSlug(c.params.slug) && (await businessBySlug(c.env, c.params.slug));
    if (!b || b.status !== 'active') throw new HttpError(404, 'Consultorio no encontrado');
    return json({ name: b.name, slug: b.slug, phone: b.phone, email: b.email });
  });
}
