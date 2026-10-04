// Cuerpo Vivo: la vista completa del paciente.
//   /api/admin/patients/:id/cuerpo…  → nutricionista (Access + PIN + negocio)
//   /api/p/…                          → paciente con su enlace privado (x-portal-token)
import { json, readJson, HttpError, str, date } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { sha256Hex } from '../lib/auth.js';
import { localNow } from '../lib/time.js';
import { getPatient } from './patients.js';

const LIMITS = { clinical: 100_000, plan: 200_000, tracking: 10_000, log: 10_000 };
const LAB_KEYS = /^(col|ldl|hdl|tg|glu|hba1c|creat|tfg|bun|urico|k|hb|vitd|tsh)$/;

function jsonDoc(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field} debe ser un objeto`);
  const s = JSON.stringify(value);
  if (s.length > LIMITS[field]) throw new HttpError(413, `${field} es demasiado grande`);
  return s;
}
const parse = (s) => (s ? JSON.parse(s) : null);

// Todo lo que necesita la vista, en una sola respuesta.
async function loadCuerpo(c, patientId, { forPatient = false } = {}) {
  const db = tenantDb(c);
  const bid = c.businessId;
  const patient = await getPatient(db, bid, patientId);
  const today = localNow(c.timezone).date;
  const [consultations, labs, recs, profile, log, next, business] = await db.batch([
    db.prepare(
      `SELECT id, date, weight_kg, fat_pct, muscle_pct, measures FROM consultations
        WHERE business_id = ? AND patient_id = ? ORDER BY date ASC, created_at ASC`,
      bid, patientId,
    ),
    db.prepare(
      'SELECT id, date, vals FROM patient_labs WHERE business_id = ? AND patient_id = ? ORDER BY date ASC',
      bid, patientId,
    ),
    db.prepare(
      `SELECT r.id, r.text, r.created_at, COALESCE(u.name, u.email) AS author
         FROM recommendations r LEFT JOIN users u ON u.id = r.author_id
        WHERE r.business_id = ? AND r.patient_id = ? ORDER BY r.created_at DESC LIMIT 50`,
      bid, patientId,
    ),
    db.prepare('SELECT clinical, plan, tracking FROM patient_profiles WHERE business_id = ? AND patient_id = ?', bid, patientId),
    db.prepare('SELECT data FROM patient_logs WHERE business_id = ? AND patient_id = ? AND day = ?', bid, patientId, today),
    db.prepare(
      `SELECT starts_at, kind FROM appointments WHERE business_id = ? AND patient_id = ?
          AND status = 'scheduled' AND starts_at >= ? ORDER BY starts_at LIMIT 1`,
      bid, patientId, today,
    ),
    db.prepare('SELECT name FROM businesses WHERE id = ? /* business_id */', bid),
  ]);
  const p = profile.results[0] || {};
  const { notes, doc_id, ...visible } = patient;
  return {
    today,
    business: business.results[0]?.name || '',
    patient: forPatient ? visible : patient,
    consultations: consultations.results.map((x) => ({ ...x, measures: parse(x.measures) || {} })),
    labs: labs.results.map((x) => ({ id: x.id, date: x.date, vals: parse(x.vals) || {} })),
    recs: recs.results,
    clinical: parse(p.clinical),
    plan: parse(p.plan),
    tracking: parse(p.tracking),
    log: parse(log.results[0]?.data),
    nextAppointment: next.results[0] || null,
  };
}

async function saveProfile(c, patientId, fields) {
  const db = tenantDb(c);
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (!sets.length) throw new HttpError(400, 'Nada para guardar');
  await db.batch([
    db.prepare(
      'INSERT OR IGNORE INTO patient_profiles (patient_id, business_id) VALUES (?, ?) /* business_id */',
      patientId, c.businessId,
    ),
    db.prepare(
      `UPDATE patient_profiles SET ${sets.join(', ')}, updated_at = datetime('now') WHERE business_id = ? AND patient_id = ?`,
      ...vals, c.businessId, patientId,
    ),
  ]);
}

async function saveLog(c, patientId, day, data) {
  await tenantDb(c).run(
    `INSERT INTO patient_logs (patient_id, business_id, day, data) VALUES (?, ?, ?, ?)
     ON CONFLICT (patient_id, day) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
     WHERE patient_logs.business_id = excluded.business_id`,
    patientId, c.businessId, date(day, { required: true, label: 'Día' }), jsonDoc(data, 'log'),
  );
}

export function routes(r) {
  // ---------- nutricionista ----------

  r.get('/api/admin/patients/:id/cuerpo', 'tenant', async (c) => {
    const data = await loadCuerpo(c, c.params.id);
    const link = await tenantDb(c).first(
      `SELECT created_at, last_used_at FROM portal_links
        WHERE business_id = ? AND patient_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      c.businessId, c.params.id,
    );
    return json({ ...data, portal: link, user: { name: c.user.name, email: c.user.email } });
  });

  r.put('/api/admin/patients/:id/profile', 'tenant', async (c) => {
    await getPatient(tenantDb(c), c.businessId, c.params.id);
    const body = await readJson(c.req);
    await saveProfile(c, c.params.id, {
      clinical: jsonDoc(body.clinical, 'clinical'),
      plan: jsonDoc(body.plan, 'plan'),
      tracking: jsonDoc(body.tracking, 'tracking'),
    });
    return json({ ok: true });
  });

  r.put('/api/admin/patients/:id/log/:day', 'tenant', async (c) => {
    await getPatient(tenantDb(c), c.businessId, c.params.id);
    await saveLog(c, c.params.id, c.params.day, (await readJson(c.req)).data);
    return json({ ok: true });
  });

  r.post('/api/admin/patients/:id/labs', 'tenant', async (c) => {
    const db = tenantDb(c);
    await getPatient(db, c.businessId, c.params.id);
    const body = await readJson(c.req);
    const vals = {};
    for (const [k, v] of Object.entries(body.vals || {})) {
      const n = Number(v);
      if (LAB_KEYS.test(k) && v !== '' && v !== null && Number.isFinite(n) && n >= 0 && n < 10000) vals[k] = n;
    }
    if (!Object.keys(vals).length) throw new HttpError(400, 'Escribe al menos un resultado');
    const id = uuid();
    await db.run(
      'INSERT INTO patient_labs (id, business_id, patient_id, date, vals, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      id, c.businessId, c.params.id, date(body.date, { required: true }), JSON.stringify(vals), c.user.id,
    );
    return json({ id }, 201);
  });

  r.delete('/api/admin/labs/:id', 'tenant', async (c) => {
    const res = await tenantDb(c).run('DELETE FROM patient_labs WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    if (!res.meta.changes) throw new HttpError(404, 'Examen no encontrado');
    return json({ ok: true });
  });

  r.post('/api/admin/patients/:id/recs', 'tenant', async (c) => {
    const db = tenantDb(c);
    await getPatient(db, c.businessId, c.params.id);
    const text = str((await readJson(c.req)).text, { required: true, max: 2000, label: 'Recomendación' });
    const id = uuid();
    await db.run(
      'INSERT INTO recommendations (id, business_id, patient_id, text, author_id) VALUES (?, ?, ?, ?, ?)',
      id, c.businessId, c.params.id, text, c.user.id,
    );
    return json({ id }, 201);
  });

  r.delete('/api/admin/recs/:id', 'tenant', async (c) => {
    const res = await tenantDb(c).run('DELETE FROM recommendations WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    if (!res.meta.changes) throw new HttpError(404, 'Recomendación no encontrada');
    return json({ ok: true });
  });

  // Enlace privado del paciente: se crea uno nuevo (el anterior deja de funcionar).
  r.post('/api/admin/patients/:id/portal', 'tenant', async (c) => {
    const db = tenantDb(c);
    await getPatient(db, c.businessId, c.params.id);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await db.batch([
      db.prepare(
        `UPDATE portal_links SET revoked_at = datetime('now') WHERE business_id = ? AND patient_id = ? AND revoked_at IS NULL`,
        c.businessId, c.params.id,
      ),
      db.prepare(
        'INSERT INTO portal_links (id, business_id, patient_id, created_by) VALUES (?, ?, ?, ?)',
        await sha256Hex(token), c.businessId, c.params.id, c.user.id,
      ),
    ]);
    const b = await db.first('SELECT slug FROM businesses WHERE id = ? /* business_id */', c.businessId);
    return json({ url: `${c.url.origin}/${b.slug}/p/#${token}` }, 201);
  });

  r.delete('/api/admin/patients/:id/portal', 'tenant', async (c) => {
    await tenantDb(c).run(
      `UPDATE portal_links SET revoked_at = datetime('now') WHERE business_id = ? AND patient_id = ? AND revoked_at IS NULL`,
      c.businessId, c.params.id,
    );
    return json({ ok: true });
  });

  // ---------- paciente (enlace privado) ----------

  r.get('/api/p/cuerpo', 'portal', async (c) => json(await loadCuerpo(c, c.patientId, { forPatient: true })));

  r.put('/api/p/log/:day', 'portal', async (c) => {
    await saveLog(c, c.patientId, c.params.day, (await readJson(c.req)).data);
    return json({ ok: true });
  });

  r.put('/api/p/tracking', 'portal', async (c) => {
    await saveProfile(c, c.patientId, { tracking: jsonDoc((await readJson(c.req)).tracking, 'tracking') });
    return json({ ok: true });
  });
}
