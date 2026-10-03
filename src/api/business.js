// Ajustes del negocio activo, equipo y pruebas de integraciones.
import { json, readJson, HttpError, str, oneOf, email } from '../lib/http.js';
import { tenantDb, globalDb, uuid } from '../lib/db.js';
import { sendWhatsApp } from '../integrations/whatsapp.js';
import { sendMail } from '../integrations/email.js';
import { createInvite, invitePath } from '../lib/auth.js';

const ROLES = ['owner', 'admin', 'staff'];

export function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    throw new HttpError(400, 'Zona horaria inválida');
  }
}

export function routes(r) {
  r.get('/api/admin/business', 'tenant', async (c) => {
    const b = await tenantDb(c).first(
      'SELECT id, name, slug, email, phone, timezone, wa_instance, status, created_at FROM businesses WHERE id = ? /* business_id */',
      c.businessId,
    );
    return json({
      business: b,
      role: c.role,
      integrations: {
        whatsapp: !!(c.env.EVOLUTION_URL && c.env.EVOLUTION_KEY),
        email: !!(c.env.SMTP_USER && c.env.SMTP_PASS),
      },
    });
  });

  r.put('/api/admin/business', 'manager', async (c) => {
    const body = await readJson(c.req);
    await tenantDb(c).run(
      `UPDATE businesses SET name = ?, email = ?, phone = ?, timezone = ?, wa_instance = ?, updated_at = datetime('now')
        WHERE id = ? /* business_id */`,
      str(body.name, { required: true, max: 120, label: 'Nombre' }),
      email(body.email, { label: 'Correo' }),
      str(body.phone, { max: 30, label: 'Teléfono' }),
      validTimezone(str(body.timezone, { max: 60 }) || 'America/Bogota'),
      str(body.wa_instance, { max: 80, label: 'Instancia WhatsApp' }),
      c.businessId,
    );
    return json({ ok: true });
  });

  // ---------- equipo ----------

  r.get('/api/admin/team', 'tenant', async (c) => {
    const items = await tenantDb(c).all(
      `SELECT u.id, u.email, u.name, m.role, m.created_at, (u.pin_hash IS NOT NULL) AS has_password
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = ? ORDER BY m.role, u.email`,
      c.businessId,
    );
    return json({ items });
  });

  r.post('/api/admin/team', 'manager', async (c) => {
    const body = await readJson(c.req);
    const mail = email(body.email, { required: true, label: 'Correo' });
    const role = oneOf(body.role, ROLES, { label: 'Rol', fallback: 'staff' });
    if (role === 'owner' && c.role !== 'owner') throw new HttpError(403, 'Solo un propietario puede asignar propietarios');
    const name = str(body.name, { max: 100, label: 'Nombre' });
    const gdb = globalDb(c.env);
    let user = await gdb.first('SELECT id, pin_hash FROM users WHERE email = ?', mail);
    if (!user) {
      user = { id: uuid() };
      await gdb.run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', user.id, mail, name);
    }
    await tenantDb(c).run(
      `INSERT INTO memberships (user_id, business_id, role) VALUES (?, ?, ?)
       ON CONFLICT (user_id, business_id) DO UPDATE SET role = excluded.role`,
      user.id, c.businessId, role,
    );
    // Quien aún no tiene contraseña recibe un link para crearla.
    const inviteUrl = user.pin_hash ? null : c.url.origin + invitePath(await createInvite(c.env, user.id));
    return json({ ok: true, userId: user.id, inviteUrl }, 201);
  });

  r.delete('/api/admin/team/:userId', 'manager', async (c) => {
    const db = tenantDb(c);
    if (c.params.userId === c.user.id) throw new HttpError(400, 'No puedes quitarte a ti mismo');
    const target = await db.first('SELECT role FROM memberships WHERE business_id = ? AND user_id = ?', c.businessId, c.params.userId);
    if (!target) throw new HttpError(404, 'Miembro no encontrado');
    if (target.role === 'owner' && c.role !== 'owner') throw new HttpError(403, 'Solo un propietario puede quitar propietarios');
    await db.batch([
      db.prepare('DELETE FROM memberships WHERE business_id = ? AND user_id = ?', c.businessId, c.params.userId),
      db.prepare('DELETE FROM sessions WHERE business_id = ? AND user_id = ?', c.businessId, c.params.userId),
    ]);
    return json({ ok: true });
  });

  // Link para que un miembro cree (o restablezca) su contraseña.
  r.post('/api/admin/team/:userId/invite', 'manager', async (c) => {
    const m = await tenantDb(c).first('SELECT role FROM memberships WHERE business_id = ? AND user_id = ?', c.businessId, c.params.userId);
    if (!m) throw new HttpError(404, 'Miembro no encontrado');
    if (m.role === 'owner' && c.role !== 'owner') throw new HttpError(403, 'Solo un propietario puede hacer esto');
    return json({ ok: true, inviteUrl: c.url.origin + invitePath(await createInvite(c.env, c.params.userId)) });
  });

  // ---------- pruebas de integraciones ----------

  r.post('/api/admin/integrations/whatsapp/test', 'manager', async (c) => {
    const { phone } = await readJson(c.req);
    const b = await tenantDb(c).first('SELECT name, wa_instance FROM businesses WHERE id = ? /* business_id */', c.businessId);
    await sendWhatsApp(c.env, b.wa_instance, phone, `✅ Mensaje de prueba de ${b.name}.`);
    return json({ ok: true });
  });

  r.post('/api/admin/integrations/email/test', 'manager', async (c) => {
    const body = await readJson(c.req);
    const to = email(body.to, { required: true, label: 'Destinatario' });
    const b = await tenantDb(c).first('SELECT name, email FROM businesses WHERE id = ? /* business_id */', c.businessId);
    await sendMail(c.env, {
      to,
      subject: `Prueba de correo · ${b.name}`,
      html: `<p>Este es un correo de prueba enviado desde <strong>${b.name.replace(/[<>&]/g, '')}</strong>.</p>`,
      replyTo: b.email || undefined,
    });
    return json({ ok: true });
  });
}
