import { json, readJson, HttpError, str, num, oneOf, date } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { localNow, addDays } from '../lib/time.js';
import { getPatient } from './patients.js';
import { sendWhatsApp } from '../integrations/whatsapp.js';

const KINDS = ['primera', 'control', 'virtual'];
const STATUSES = ['scheduled', 'done', 'cancelled', 'no_show'];
const KIND_TXT = { primera: 'primera consulta', control: 'consulta de control', virtual: 'consulta virtual' };

function apptFields(body) {
  return {
    patient_id: str(body.patient_id, { required: true, max: 64, label: 'Paciente' }),
    starts_at: date(body.starts_at, { required: true, withTime: true, label: 'Fecha y hora' }),
    duration_min: num(body.duration_min, { min: 5, max: 480, label: 'Duración' }) ?? 45,
    kind: oneOf(body.kind, KINDS, { label: 'Tipo', fallback: 'control' }),
    status: oneOf(body.status, STATUSES, { label: 'Estado', fallback: 'scheduled' }),
    notes: str(body.notes, { max: 1000, label: 'Notas' }),
  };
}

function fmtWhen(startsAt) {
  const d = new Date(startsAt + ':00Z');
  const day = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
  const time = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
  return `${day} a las ${time}`;
}

export function routes(r) {
  r.get('/api/admin/appointments', 'tenant', async (c) => {
    const today = localNow(c.timezone).date;
    const from = date(c.url.searchParams.get('from')) || today;
    const to = date(c.url.searchParams.get('to')) || addDays(from, 7);
    const items = await tenantDb(c).all(
      `SELECT a.*, p.first_name, p.last_name, p.phone
         FROM appointments a JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
        WHERE a.business_id = ? AND a.starts_at >= ? AND a.starts_at < ?
        ORDER BY a.starts_at`,
      c.businessId, from, addDays(to, 1),
    );
    return json({ from, to, items });
  });

  r.post('/api/admin/appointments', 'tenant', async (c) => {
    const db = tenantDb(c);
    const f = apptFields(await readJson(c.req));
    await getPatient(db, c.businessId, f.patient_id);
    const id = uuid();
    await db.run(
      `INSERT INTO appointments (id, business_id, patient_id, starts_at, duration_min, kind, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, c.businessId, f.patient_id, f.starts_at, f.duration_min, f.kind, f.status, f.notes,
    );
    return json({ id }, 201);
  });

  r.put('/api/admin/appointments/:id', 'tenant', async (c) => {
    const db = tenantDb(c);
    const f = apptFields(await readJson(c.req));
    await getPatient(db, c.businessId, f.patient_id);
    const res = await db.run(
      `UPDATE appointments SET patient_id = ?, starts_at = ?, duration_min = ?, kind = ?, status = ?, notes = ?
        WHERE business_id = ? AND id = ?`,
      f.patient_id, f.starts_at, f.duration_min, f.kind, f.status, f.notes, c.businessId, c.params.id,
    );
    if (!res.meta.changes) throw new HttpError(404, 'Cita no encontrada');
    return json({ ok: true });
  });

  r.delete('/api/admin/appointments/:id', 'tenant', async (c) => {
    const res = await tenantDb(c).run('DELETE FROM appointments WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    if (!res.meta.changes) throw new HttpError(404, 'Cita no encontrada');
    return json({ ok: true });
  });

  // Recordatorio por WhatsApp (Evolution API).
  r.post('/api/admin/appointments/:id/remind', 'tenant', async (c) => {
    const db = tenantDb(c);
    const a = await db.first(
      `SELECT a.starts_at, a.kind, p.first_name, p.phone, b.name AS business_name, b.wa_instance
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
         JOIN businesses b ON b.id = a.business_id
        WHERE a.business_id = ? AND a.id = ?`,
      c.businessId, c.params.id,
    );
    if (!a) throw new HttpError(404, 'Cita no encontrada');
    if (!a.phone) throw new HttpError(400, 'El paciente no tiene teléfono');
    const text =
      `Hola ${a.first_name} 👋, te recordamos tu ${KIND_TXT[a.kind]} en ${a.business_name} ` +
      `el ${fmtWhen(a.starts_at)}. Si necesitas reprogramar, responde a este mensaje.`;
    await sendWhatsApp(c.env, a.wa_instance, a.phone, text);
    await db.run(`UPDATE appointments SET reminded_at = datetime('now') WHERE business_id = ? AND id = ?`, c.businessId, c.params.id);
    return json({ ok: true });
  });
}
