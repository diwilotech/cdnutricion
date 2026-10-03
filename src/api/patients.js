import { json, readJson, HttpError, str, num, oneOf, date, email } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { localNow } from '../lib/time.js';

const PAGE_SIZE = 25;

function patientFields(body) {
  return {
    first_name: str(body.first_name, { required: true, max: 80, label: 'Nombre' }),
    last_name: str(body.last_name, { max: 80, label: 'Apellido' }) || '',
    doc_id: str(body.doc_id, { max: 30, label: 'Documento' }),
    sex: oneOf(body.sex, ['F', 'M'], { label: 'Sexo' }),
    birth_date: date(body.birth_date, { label: 'Fecha de nacimiento' }),
    phone: str(body.phone, { max: 30, label: 'Teléfono' }),
    email: email(body.email, { label: 'Correo' }),
    height_cm: num(body.height_cm, { min: 40, max: 250, label: 'Estatura' }),
    goal: str(body.goal, { max: 300, label: 'Objetivo' }),
    notes: str(body.notes, { max: 4000, label: 'Notas' }),
  };
}

export async function getPatient(db, bid, id) {
  const p = await db.first('SELECT * FROM patients WHERE business_id = ? AND id = ?', bid, id);
  if (!p) throw new HttpError(404, 'Paciente no encontrado');
  return p;
}

export function routes(r) {
  r.get('/api/admin/patients', 'tenant', async (c) => {
    const db = tenantDb(c);
    const q = (c.url.searchParams.get('q') || '').trim();
    const status = c.url.searchParams.get('status') === 'archived' ? 'archived' : 'active';
    const page = Math.max(1, parseInt(c.url.searchParams.get('page') || '1', 10) || 1);
    const like = `%${q.replace(/[%_]/g, '')}%`;

    const where = `p.business_id = ?1 AND p.status = ?2
      AND (?3 = '' OR p.first_name || ' ' || p.last_name LIKE ?4 OR p.doc_id LIKE ?4 OR p.phone LIKE ?4)`;
    const [rows, total] = await db.batch([
      db.prepare(
        `SELECT p.id, p.first_name, p.last_name, p.doc_id, p.phone, p.email, p.sex, p.birth_date, p.created_at,
                (SELECT MAX(date) FROM consultations c WHERE c.business_id = p.business_id AND c.patient_id = p.id) AS last_visit,
                (SELECT weight_kg FROM consultations c WHERE c.business_id = p.business_id AND c.patient_id = p.id
                  AND weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1) AS last_weight,
                (SELECT MIN(starts_at) FROM appointments a WHERE a.business_id = p.business_id AND a.patient_id = p.id
                  AND a.status = 'scheduled' AND a.starts_at >= ?7) AS next_appt
           FROM patients p WHERE ${where}
          ORDER BY p.last_name, p.first_name LIMIT ?5 OFFSET ?6`,
        c.businessId, status, q, like, PAGE_SIZE, (page - 1) * PAGE_SIZE, localNow(c.timezone).date,
      ),
      db.prepare(`SELECT COUNT(*) AS n FROM patients p WHERE ${where}`, c.businessId, status, q, like),
    ]);
    return json({ items: rows.results, total: total.results[0].n, page, pageSize: PAGE_SIZE });
  });

  r.post('/api/admin/patients', 'tenant', async (c) => {
    const f = patientFields(await readJson(c.req));
    const id = uuid();
    await tenantDb(c).run(
      `INSERT INTO patients (id, business_id, first_name, last_name, doc_id, sex, birth_date, phone, email, height_cm, goal, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, c.businessId, f.first_name, f.last_name, f.doc_id, f.sex, f.birth_date, f.phone, f.email, f.height_cm, f.goal, f.notes,
    );
    return json({ id }, 201);
  });

  r.get('/api/admin/patients/:id', 'tenant', async (c) => {
    const db = tenantDb(c);
    const patient = await getPatient(db, c.businessId, c.params.id);
    const [consultations, appointments, files] = await db.batch([
      db.prepare(
        `SELECT id, date, weight_kg, fat_pct, muscle_pct, measures, notes FROM consultations
          WHERE business_id = ? AND patient_id = ? ORDER BY date DESC`,
        c.businessId, patient.id,
      ),
      db.prepare(
        `SELECT id, starts_at, duration_min, kind, status, notes, reminded_at FROM appointments
          WHERE business_id = ? AND patient_id = ? ORDER BY starts_at DESC LIMIT 50`,
        c.businessId, patient.id,
      ),
      db.prepare(
        `SELECT id, name, content_type, size, created_at FROM files
          WHERE business_id = ? AND patient_id = ? ORDER BY created_at DESC`,
        c.businessId, patient.id,
      ),
    ]);
    return json({
      patient,
      consultations: consultations.results.map((x) => ({ ...x, measures: x.measures ? JSON.parse(x.measures) : {} })),
      appointments: appointments.results,
      files: files.results,
    });
  });

  r.put('/api/admin/patients/:id', 'tenant', async (c) => {
    const db = tenantDb(c);
    const body = await readJson(c.req);
    await getPatient(db, c.businessId, c.params.id);
    const f = patientFields(body);
    const status = oneOf(body.status, ['active', 'archived'], { label: 'Estado', fallback: 'active' });
    await db.run(
      `UPDATE patients SET first_name = ?, last_name = ?, doc_id = ?, sex = ?, birth_date = ?, phone = ?, email = ?,
              height_cm = ?, goal = ?, notes = ?, status = ?, updated_at = datetime('now')
        WHERE business_id = ? AND id = ?`,
      f.first_name, f.last_name, f.doc_id, f.sex, f.birth_date, f.phone, f.email, f.height_cm, f.goal, f.notes, status,
      c.businessId, c.params.id,
    );
    return json({ ok: true });
  });

  // Borrado definitivo (incluye consultas, citas y archivos) — solo owner/admin.
  r.delete('/api/admin/patients/:id', 'manager', async (c) => {
    const db = tenantDb(c);
    await getPatient(db, c.businessId, c.params.id);
    const files = await db.all('SELECT r2_key FROM files WHERE business_id = ? AND patient_id = ?', c.businessId, c.params.id);
    if (files.length) await c.env.FILES.delete(files.map((f) => f.r2_key));
    await db.batch([
      db.prepare('DELETE FROM files WHERE business_id = ? AND patient_id = ?', c.businessId, c.params.id),
      db.prepare('DELETE FROM consultations WHERE business_id = ? AND patient_id = ?', c.businessId, c.params.id),
      db.prepare('DELETE FROM appointments WHERE business_id = ? AND patient_id = ?', c.businessId, c.params.id),
      db.prepare('DELETE FROM patients WHERE business_id = ? AND id = ?', c.businessId, c.params.id),
    ]);
    return json({ ok: true });
  });

  // ---------- consultas (mediciones) ----------

  r.post('/api/admin/patients/:id/consultations', 'tenant', async (c) => {
    const db = tenantDb(c);
    await getPatient(db, c.businessId, c.params.id);
    const body = await readJson(c.req);
    const measures = {};
    for (const [k, v] of Object.entries(body.measures || {})) {
      if (!/^\w{1,30}$/.test(k)) continue;
      const n = num(v, { min: 0, max: 1000, label: k });
      if (n !== null) measures[k] = n;
    }
    const id = uuid();
    await db.run(
      `INSERT INTO consultations (id, business_id, patient_id, date, weight_kg, fat_pct, muscle_pct, measures, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, c.businessId, c.params.id,
      date(body.date, { required: true }),
      num(body.weight_kg, { min: 1, max: 400, label: 'Peso' }),
      num(body.fat_pct, { min: 1, max: 80, label: 'Grasa' }),
      num(body.muscle_pct, { min: 1, max: 80, label: 'Músculo' }),
      Object.keys(measures).length ? JSON.stringify(measures) : null,
      str(body.notes, { max: 4000, label: 'Notas' }),
      c.user.id,
    );
    return json({ id }, 201);
  });

  r.delete('/api/admin/consultations/:id', 'tenant', async (c) => {
    const res = await tenantDb(c).run('DELETE FROM consultations WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    if (!res.meta.changes) throw new HttpError(404, 'Consulta no encontrada');
    return json({ ok: true });
  });
}
