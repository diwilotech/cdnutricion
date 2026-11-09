import { json, readJson, HttpError } from '../lib/http.js';
import { tenantDb } from '../lib/db.js';
import { localNow, addDays } from '../lib/time.js';

export function routes(r) {
  r.get('/api/admin/dashboard', 'tenant', async (c) => {
    const db = tenantDb(c);
    const bid = c.businessId;
    const { date: today, datetime: now } = localNow(c.timezone);
    const monthStart = today.slice(0, 8) + '01';
    const weekEnd = addDays(today, 7);

    const [kpis, todayAppts, upcoming, recentPatients, progress] = await db.batch([
      db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM patients WHERE business_id = ?1 AND status = 'active') AS active_patients,
           (SELECT COUNT(*) FROM patients WHERE business_id = ?1 AND created_at >= ?2) AS new_patients_month,
           (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'scheduled'
               AND substr(starts_at, 1, 10) = ?3) AS appts_today,
           (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'scheduled'
               AND starts_at >= ?4 AND starts_at < ?5) AS appts_week,
           (SELECT COUNT(*) FROM consultations WHERE business_id = ?1 AND date >= ?2) AS consultations_month,
           (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'no_show'
               AND starts_at >= ?2) AS no_show_month`,
        bid, monthStart, today, now, weekEnd,
      ),
      db.prepare(
        `SELECT a.id, a.starts_at, a.duration_min, a.kind, a.status, p.id AS patient_id,
                p.first_name, p.last_name, p.phone
           FROM appointments a JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
          WHERE a.business_id = ? AND substr(a.starts_at, 1, 10) = ?
          ORDER BY a.starts_at`,
        bid, today,
      ),
      db.prepare(
        `SELECT a.id, a.starts_at, a.kind, p.id AS patient_id, p.first_name, p.last_name
           FROM appointments a JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
          WHERE a.business_id = ? AND a.status = 'scheduled' AND a.starts_at >= ? AND a.starts_at < ?
          ORDER BY a.starts_at LIMIT 8`,
        bid, addDays(today, 1), weekEnd,
      ),
      db.prepare(
        `SELECT id, first_name, last_name, created_at FROM patients
          WHERE business_id = ? ORDER BY created_at DESC LIMIT 5`,
        bid,
      ),
      // Cambio de peso entre la primera y la última consulta de cada paciente activo.
      db.prepare(
        `WITH ranked AS (
           SELECT patient_id, weight_kg,
                  ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY date ASC)  AS first_rn,
                  ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY date DESC) AS last_rn
             FROM consultations WHERE business_id = ? AND weight_kg IS NOT NULL)
         SELECT COUNT(*) AS tracked,
                SUM(CASE WHEN l.weight_kg < f.weight_kg THEN 1 ELSE 0 END) AS improving,
                ROUND(SUM(f.weight_kg - l.weight_kg), 1) AS kg_total
           FROM ranked f JOIN ranked l ON l.patient_id = f.patient_id AND l.last_rn = 1
          WHERE f.first_rn = 1 AND f.last_rn > 1`,
        bid,
      ),
    ]);

    return json({
      today,
      kpis: kpis.results[0],
      progress: progress.results[0],
      todayAppointments: todayAppts.results,
      upcoming: upcoming.results,
      recentPatients: recentPatients.results,
    });
  });

  // Tablero del consultorio: consultas y pacientes nuevos por mes, asistencia, tipos de cita, pacientes que llevan tiempo sin volver
  // y quiénes más han avanzado. Todo del propio consultorio.
  r.get('/api/admin/tablero', 'tenant', async (c) => {
    const db = tenantDb(c), bid = c.businessId;
    const { date: today } = localNow(c.timezone);
    const d = new Date(today + 'T12:00:00Z'), meses = [];
    for (let i = 5; i >= 0; i--) meses.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    const desde = meses[0] + '-01', hace30 = addDays(today, -30), hace60 = addDays(today, -60);
    const [cons, nuevos, estados, tipos, sinVolver, avance] = await db.batch([
      db.prepare(`SELECT substr(date, 1, 7) AS m, COUNT(*) AS n FROM consultations WHERE business_id = ? AND date >= ? GROUP BY m`, bid, desde),
      db.prepare(`SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM patients WHERE business_id = ? AND created_at >= ? GROUP BY m`, bid, desde),
      db.prepare(`SELECT status, COUNT(*) AS n FROM appointments WHERE business_id = ? AND substr(starts_at, 1, 10) BETWEEN ? AND ? GROUP BY status`, bid, hace30, today),
      db.prepare(`SELECT kind, COUNT(*) AS n FROM appointments WHERE business_id = ? AND status IN ('done','scheduled') AND substr(starts_at, 1, 10) BETWEEN ? AND ? GROUP BY kind`, bid, hace30, today),
      // Pacientes activos cuya última consulta fue hace más de 60 días (o que nunca tuvieron una y ya llevan 30 días)
      db.prepare(
        `SELECT p.id, p.first_name, p.last_name, p.phone, MAX(k.date) AS ultima, p.created_at
           FROM patients p LEFT JOIN consultations k ON k.patient_id = p.id AND k.business_id = p.business_id
          WHERE p.business_id = ? AND p.status = 'active'
          GROUP BY p.id HAVING (ultima IS NOT NULL AND ultima < ?) OR (ultima IS NULL AND substr(p.created_at, 1, 10) < ?)
          ORDER BY ultima LIMIT 8`, bid, hace60, hace30),
      db.prepare(
        `WITH ranked AS (SELECT patient_id, weight_kg,
                  ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY date ASC) AS first_rn,
                  ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY date DESC) AS last_rn
             FROM consultations WHERE business_id = ? AND weight_kg IS NOT NULL)
         SELECT p.id, p.first_name, p.last_name, ROUND(f.weight_kg - l.weight_kg, 1) AS kg
           FROM ranked f JOIN ranked l ON l.patient_id = f.patient_id AND l.last_rn = 1
           JOIN patients p ON p.id = f.patient_id AND p.business_id = ?
          WHERE f.first_rn = 1 AND f.last_rn > 1 AND p.status = 'active' ORDER BY kg DESC LIMIT 6`, bid, bid),
    ]);
    const por = (rows, m) => rows.results.find((x) => x.m === m)?.n || 0;
    const est = Object.fromEntries(estados.results.map((x) => [x.status, x.n]));
    const medidas = (est.done || 0) + (est.no_show || 0);
    return json({
      meses: meses.map((m) => ({ mes: m, consultas: por(cons, m), nuevos: por(nuevos, m) })),
      estados: est, asistencia: medidas ? Math.round(((est.done || 0) / medidas) * 100) : null,
      tipos: tipos.results, sin_volver: sinVolver.results, avance: avance.results,
    });
  });

  // Embudo de citas (hace 7 días a 14 adelante) y cambio de estado desde el tablero
  r.get('/api/admin/embudo', 'tenant', async (c) => {
    const today = localNow(c.timezone).date;
    const items = await tenantDb(c).all(
      `SELECT a.id, a.starts_at, a.kind, a.status, p.first_name, p.last_name FROM appointments a
         JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
        WHERE a.business_id = ? AND substr(a.starts_at, 1, 10) BETWEEN ? AND ? ORDER BY a.starts_at LIMIT 300`, c.businessId, addDays(today, -7), addDays(today, 14));
    return json({ today, items });
  });
  r.post('/api/admin/appointments/:id/status', 'tenant', async (c) => {
    const { status } = await readJson(c.req);
    if (!['scheduled', 'done', 'cancelled', 'no_show'].includes(status)) throw new HttpError(400, 'Estado no válido');
    const res = await tenantDb(c).run('UPDATE appointments SET status = ? WHERE business_id = ? AND id = ?', status, c.businessId, c.params.id);
    if (!res.meta.changes) throw new HttpError(404, 'Cita no encontrada');
    return json({ ok: true });
  });

  // CSV de pacientes, consultas o citas (los mismos permisos del panel)
  const cel = (v) => { const t = String(v ?? '').replace(/\r?\n/g, ' '); return /[",;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = (filas, nombre) => new Response('\uFEFF' + filas.map((f) => f.map(cel).join(',')).join('\r\n'),
    { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${nombre}.csv"`, 'cache-control': 'no-store' } });
  r.get('/api/admin/export/:que', 'tenant', async (c) => {
    const db = tenantDb(c), bid = c.businessId, que = c.params.que;
    if (que === 'pacientes') {
      const rows = await db.all(`SELECT first_name, last_name, doc_id, sex, birth_date, phone, email, height_cm, goal, status, created_at FROM patients WHERE business_id = ? ORDER BY last_name, first_name`, bid);
      return csv([['Nombre', 'Apellido', 'Documento', 'Sexo', 'Nacimiento', 'Celular', 'Correo', 'Estatura cm', 'Objetivo', 'Estado', 'Desde'], ...rows.map((x) => [x.first_name, x.last_name, x.doc_id || '', x.sex || '', x.birth_date || '', x.phone || '', x.email || '', x.height_cm ?? '', x.goal || '', x.status, String(x.created_at).slice(0, 10)])], 'pacientes');
    }
    if (que === 'consultas') {
      const rows = await db.all(`SELECT k.date, p.first_name, p.last_name, k.weight_kg, k.fat_pct, k.muscle_pct, k.notes FROM consultations k JOIN patients p ON p.id = k.patient_id AND p.business_id = k.business_id WHERE k.business_id = ? ORDER BY k.date DESC`, bid);
      return csv([['Fecha', 'Paciente', 'Peso kg', 'Grasa %', 'Músculo %', 'Notas'], ...rows.map((x) => [x.date, `${x.first_name} ${x.last_name}`.trim(), x.weight_kg ?? '', x.fat_pct ?? '', x.muscle_pct ?? '', x.notes || ''])], 'consultas');
    }
    if (que === 'citas') {
      const rows = await db.all(`SELECT a.starts_at, a.duration_min, a.kind, a.status, p.first_name, p.last_name, p.phone FROM appointments a JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id WHERE a.business_id = ? ORDER BY a.starts_at DESC LIMIT 5000`, bid);
      return csv([['Fecha y hora', 'Duración min', 'Tipo', 'Estado', 'Paciente', 'Celular'], ...rows.map((x) => [x.starts_at.replace('T', ' '), x.duration_min, x.kind, x.status, `${x.first_name} ${x.last_name}`.trim(), x.phone || ''])], 'citas');
    }
    throw new HttpError(404, 'Exportación no disponible');
  });
}
