// Cuerpo Vivo: la vista completa del paciente.
//   /api/admin/patients/:id/cuerpo…  → nutricionista (Access + PIN + negocio)
//   /api/p/…                          → paciente con su enlace privado (x-portal-token)
import { json, readJson, HttpError, str, date } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { sha256Hex } from '../lib/auth.js';
import { localNow } from '../lib/time.js';
import { getPatient } from './patients.js';
import { logoUrl, memberPhotoUrl, parseCard } from './card.js';

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

// Enlace vigente del paciente. Los creados antes de guardar el token no tienen url (hay que crear uno nuevo).
async function portalUrl(c, token) {
  const b = await tenantDb(c).first('SELECT slug FROM businesses WHERE id = ? /* business_id */', c.businessId);
  return `${c.url.origin}/${b.slug}/p/#${token}`;
}
async function activePortal(c, patientId) {
  const link = await tenantDb(c).first(
    `SELECT created_at, last_used_at, token FROM portal_links
      WHERE business_id = ? AND patient_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    c.businessId, patientId,
  );
  if (!link) return null;
  const { token, ...rest } = link;
  return { ...rest, url: token ? await portalUrl(c, token) : null };
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
    const portal = await activePortal(c, c.params.id);
    return json({ ...data, portal, user: { name: c.user.name, email: c.user.email } });
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
        'INSERT INTO portal_links (id, business_id, patient_id, created_by, token) VALUES (?, ?, ?, ?, ?)',
        await sha256Hex(token), c.businessId, c.params.id, c.user.id, token,
      ),
    ]);
    return json({ url: await portalUrl(c, token) }, 201);
  });

  r.delete('/api/admin/patients/:id/portal', 'tenant', async (c) => {
    await tenantDb(c).run(
      `UPDATE portal_links SET revoked_at = datetime('now') WHERE business_id = ? AND patient_id = ? AND revoked_at IS NULL`,
      c.businessId, c.params.id,
    );
    return json({ ok: true });
  });

  // ---------- informe de la cita: el plan entregado y cómo va el paciente ese día ----------

  // Entregar el plan. Queda ligado a la cita indicada, o a la de hoy si la hay.
  //  - Cita de hoy o futura: se actualiza con el plan vigente (reimprimir tras editar trae lo último).
  //  - Cita pasada: queda fija; si nunca se imprimió, toma el último plan entregado hasta ese día.
  //  - Sin cita: si nada cambió desde la última entrega, se reusa esa.
  r.post('/api/admin/patients/:id/plans', 'tenant', async (c) => {
    const db = tenantDb(c);
    const bid = c.businessId, pid = c.params.id;
    await getPatient(db, bid, pid);
    const body = await readJson(c.req);
    const plan = jsonDoc(body.plan, 'plan');
    if (!plan) throw new HttpError(400, 'Falta el plan');
    const today = localNow(c.timezone).date;
    const appt = body.appointment_id
      ? await db.first('SELECT id, starts_at FROM appointments WHERE business_id = ? AND patient_id = ? AND id = ?', bid, pid, str(body.appointment_id, { max: 64 }))
      : await db.first(
        `SELECT id, starts_at FROM appointments WHERE business_id = ? AND patient_id = ? AND substr(starts_at, 1, 10) = ?
            AND status IN ('scheduled', 'done') ORDER BY starts_at LIMIT 1`,
        bid, pid, today,
      );
    if (body.appointment_id && !appt) throw new HttpError(404, 'Cita no encontrada');
    const day = appt ? appt.starts_at.slice(0, 10) : today;
    const past = day < today;

    const [existing, recs, weight, before] = await db.batch([
      db.prepare('SELECT id FROM patient_plans WHERE business_id = ? AND appointment_id = ?', bid, appt?.id ?? ''),
      db.prepare(
        `SELECT text FROM recommendations WHERE business_id = ? AND patient_id = ? AND substr(created_at, 1, 10) <= ?
          ORDER BY created_at DESC LIMIT 8`,
        bid, pid, day,
      ),
      db.prepare(
        `SELECT weight_kg FROM consultations WHERE business_id = ? AND patient_id = ? AND weight_kg IS NOT NULL AND date <= ?
          ORDER BY date DESC, created_at DESC LIMIT 1`,
        bid, pid, day,
      ),
      db.prepare(
        `SELECT id, plan, recs, appointment_id FROM patient_plans WHERE business_id = ? AND patient_id = ? AND substr(created_at, 1, 10) <= ?
          ORDER BY created_at DESC LIMIT 1`,
        bid, pid, past ? day : '9999-12-31',
      ),
    ]);
    const recsDoc = JSON.stringify(recs.results.map((x) => x.text));
    const kg = weight.results[0]?.weight_kg ?? null;
    const prev = before.results[0];
    const found = existing.results[0];
    if (found) {
      if (!past) {
        await db.run(
          'UPDATE patient_plans SET plan = ?, recs = ?, weight_kg = ?, created_by = ? WHERE business_id = ? AND id = ?',
          plan, recsDoc, kg, c.user.id, bid, found.id,
        );
      }
      return json({ id: found.id });
    }
    if (!appt && prev && !prev.appointment_id && prev.plan === plan && prev.recs === recsDoc) return json({ id: prev.id, reused: true });
    const id = uuid();
    await db.run(
      `INSERT INTO patient_plans (id, business_id, patient_id, appointment_id, plan, recs, weight_kg, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, bid, pid, appt?.id ?? null, past && prev ? prev.plan : plan, recsDoc, kg, c.user.id,
    );
    return json({ id }, 201);
  });

  // Todo lo que lleva la hoja: plan entregado, cómo va (medidas y exámenes hasta ese día), consultorio, quién lo entrega y QR.
  r.get('/api/admin/plans/:planId', 'tenant', async (c) => {
    const db = tenantDb(c);
    const bid = c.businessId;
    const row = await db.first(
      `SELECT p.id, p.patient_id, p.plan, p.recs, p.weight_kg, p.created_at, p.created_by,
              a.starts_at AS appt_at, a.kind AS appt_kind, a.status AS appt_status,
              u.name AS user_name, m.card AS member_card, m.handle, m.photo_key
         FROM patient_plans p
         LEFT JOIN appointments a ON a.id = p.appointment_id AND a.business_id = p.business_id
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN memberships m ON m.user_id = p.created_by AND m.business_id = p.business_id
        WHERE p.business_id = ? AND p.id = ?`,
      bid, c.params.planId,
    );
    if (!row) throw new HttpError(404, 'Plan no encontrado');
    const day = row.appt_at ? row.appt_at.slice(0, 10) : row.created_at.slice(0, 10);
    const pid = row.patient_id;
    const [patient, business, next, latest, cons, labs] = await db.batch([
      db.prepare('SELECT id, first_name, last_name, birth_date, sex, height_cm, goal FROM patients WHERE business_id = ? AND id = ?', bid, pid),
      db.prepare('SELECT name, slug, phone, email, logo_key, card FROM businesses WHERE id = ? /* business_id */', bid),
      db.prepare(
        `SELECT starts_at FROM appointments WHERE business_id = ? AND patient_id = ?
            AND status = 'scheduled' AND substr(starts_at, 1, 10) > ? ORDER BY starts_at LIMIT 1`,
        bid, pid, day,
      ),
      db.prepare('SELECT id FROM patient_plans WHERE business_id = ? AND patient_id = ? ORDER BY created_at DESC LIMIT 1', bid, pid),
      db.prepare(
        `SELECT date, weight_kg, fat_pct, muscle_pct, measures FROM consultations
          WHERE business_id = ? AND patient_id = ? AND date <= ? ORDER BY date ASC, created_at ASC`,
        bid, pid, day,
      ),
      db.prepare(
        'SELECT date, vals FROM patient_labs WHERE business_id = ? AND patient_id = ? AND date <= ? ORDER BY date DESC LIMIT 2',
        bid, pid, day,
      ),
    ]);
    const b = business.results[0];
    const bc = parseCard(b.card), mc = parseCard(row.member_card);
    const portal = await activePortal(c, pid);
    // Evolución hasta ese día: primera, anterior y la del día (o la última antes).
    const hist = cons.results.map((x) => {
      const m = parse(x.measures) || {};
      return { date: x.date, weight_kg: x.weight_kg, fat_pct: x.fat_pct, muscle_pct: x.muscle_pct, cintura: m.cintura ?? null, cadera: m.cadera ?? null };
    });
    const labRows = labs.results.map((x) => ({ date: x.date, vals: parse(x.vals) || {} }));
    return json({
      id: row.id,
      created_at: row.created_at,
      day,
      latest: latest.results[0]?.id === row.id,
      appointment: row.appt_at ? { starts_at: row.appt_at, kind: row.appt_kind, status: row.appt_status } : null,
      plan: parse(row.plan),
      recs: parse(row.recs) || [],
      weight_kg: row.weight_kg,
      patient: patient.results[0] || null,
      progress: {
        count: hist.length,
        first: hist.length > 2 ? hist[0] : null,
        previous: hist.length > 1 ? hist.at(-2) : null,
        current: hist.at(-1) || null,
      },
      labs: labRows[0] || null,
      labsPrev: labRows[1] || null,
      nextAppointment: next.results[0]?.starts_at || null,
      business: { name: b.name, phone: bc.phone || b.phone, email: b.email, address: bc.address || null, logo: logoUrl(b.slug, b.logo_key) },
      professional: row.created_by ? {
        name: mc.displayName || row.user_name,
        specialty: mc.specialty || null,
        phone: mc.phone || null,
        photo: row.handle ? memberPhotoUrl(b.slug, row.handle, row.photo_key) : null,
      } : null,
      portalUrl: portal?.url || null,
      portalActive: !!portal,
    });
  });

  // Informes ya generados por cita (para marcar en la ficha cuáles tienen PDF).
  r.get('/api/admin/patients/:id/plans', 'tenant', async (c) => {
    const rows = await tenantDb(c).all(
      'SELECT id, appointment_id FROM patient_plans WHERE business_id = ? AND patient_id = ? AND appointment_id IS NOT NULL',
      c.businessId, c.params.id,
    );
    return json({ plans: rows });
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
