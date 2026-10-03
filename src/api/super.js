// Gestión de la plataforma (solo superadministradores): negocios / tenants.
import { json, readJson, HttpError, str, oneOf, email } from '../lib/http.js';
import { globalDb, uuid } from '../lib/db.js';
import { validTimezone } from './business.js';

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

export function routes(r) {
  r.get('/api/admin/super/businesses', 'super', async (c) => {
    const items = await globalDb(c.env).all(
      `SELECT b.id, b.name, b.slug, b.email, b.phone, b.timezone, b.status, b.created_at,
              (SELECT COUNT(*) FROM patients p WHERE p.business_id = b.id AND p.status = 'active') AS patients,
              (SELECT COUNT(*) FROM memberships m WHERE m.business_id = b.id) AS members,
              (SELECT GROUP_CONCAT(u.email, ', ') FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.business_id = b.id AND m.role = 'owner') AS owners,
              (SELECT MAX(date) FROM consultations x WHERE x.business_id = b.id) AS last_activity
         FROM businesses b ORDER BY b.created_at DESC`,
    );
    return json({ items });
  });

  // Crea un negocio y (opcional) su propietario.
  r.post('/api/admin/super/businesses', 'super', async (c) => {
    const body = await readJson(c.req);
    const name = str(body.name, { required: true, max: 120, label: 'Nombre' });
    const slug = slugify(str(body.slug, { max: 50 }) || name);
    if (!slug) throw new HttpError(400, 'Identificador inválido');
    const ownerEmail = email(body.owner_email, { label: 'Correo del propietario' });
    const db = globalDb(c.env);
    if (await db.first('SELECT 1 FROM businesses WHERE slug = ?', slug)) throw new HttpError(409, 'Ya existe un negocio con ese identificador');

    const id = uuid();
    const stmts = [
      db.prepare(
        'INSERT INTO businesses (id, name, slug, email, phone, timezone) VALUES (?, ?, ?, ?, ?, ?)',
        id, name, slug, email(body.email, { label: 'Correo' }), str(body.phone, { max: 30 }),
        validTimezone(str(body.timezone, { max: 60 }) || 'America/Bogota'),
      ),
    ];
    if (ownerEmail) {
      let owner = await db.first('SELECT id FROM users WHERE email = ?', ownerEmail);
      if (!owner) {
        owner = { id: uuid() };
        stmts.push(db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', owner.id, ownerEmail, str(body.owner_name, { max: 100 })));
      }
      stmts.push(db.prepare("INSERT INTO memberships (user_id, business_id, role) VALUES (?, ?, 'owner')", owner.id, id));
    }
    await db.batch(stmts);
    return json({ id, slug }, 201);
  });

  r.put('/api/admin/super/businesses/:id', 'super', async (c) => {
    const body = await readJson(c.req);
    const res = await globalDb(c.env).run(
      `UPDATE businesses SET name = ?, email = ?, phone = ?, timezone = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      str(body.name, { required: true, max: 120, label: 'Nombre' }),
      email(body.email, { label: 'Correo' }),
      str(body.phone, { max: 30 }),
      validTimezone(str(body.timezone, { max: 60 }) || 'America/Bogota'),
      oneOf(body.status, ['active', 'suspended'], { label: 'Estado', fallback: 'active' }),
      c.params.id,
    );
    if (!res.meta.changes) throw new HttpError(404, 'Negocio no encontrado');
    return json({ ok: true });
  });

  // Agrega un propietario a un negocio existente.
  r.post('/api/admin/super/businesses/:id/owners', 'super', async (c) => {
    const body = await readJson(c.req);
    const ownerEmail = email(body.email, { required: true, label: 'Correo' });
    const db = globalDb(c.env);
    if (!(await db.first('SELECT 1 FROM businesses WHERE id = ?', c.params.id))) throw new HttpError(404, 'Negocio no encontrado');
    let owner = await db.first('SELECT id FROM users WHERE email = ?', ownerEmail);
    if (!owner) {
      owner = { id: uuid() };
      await db.run('INSERT INTO users (id, email) VALUES (?, ?)', owner.id, ownerEmail);
    }
    await db.run(
      `INSERT INTO memberships (user_id, business_id, role) VALUES (?, ?, 'owner')
       ON CONFLICT (user_id, business_id) DO UPDATE SET role = 'owner'`,
      owner.id, c.params.id,
    );
    return json({ ok: true }, 201);
  });
}
