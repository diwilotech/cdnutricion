import { json } from '../lib/http.js';
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
}
