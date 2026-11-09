// Herramientas de IA hechas a mano: el resumen en vivo del consultorio.
import { tenantDb } from '../lib/db.js';
import { localNow, addDays } from '../lib/time.js';

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });

export default [
  {
    name: 'pacientes.resumen_en_vivo', modulo: 'pacientes', rol: 'staff', tipo: 'lectura',
    description: 'Resumen en vivo del consultorio: pacientes activos y nuevos del mes, citas de hoy y de la semana, consultas e inasistencias del mes.',
    inputSchema: S({}),
    run: async (c) => {
      const db = tenantDb(c), bid = c.businessId, { date: hoy } = localNow(c.timezone), mes = hoy.slice(0, 8) + '01';
      const k = await db.first(
        `SELECT (SELECT COUNT(*) FROM patients WHERE business_id = ?1 AND status = 'active') AS pacientes_activos,
                (SELECT COUNT(*) FROM patients WHERE business_id = ?1 AND created_at >= ?2) AS pacientes_nuevos_mes,
                (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'scheduled' AND substr(starts_at, 1, 10) = ?3) AS citas_hoy,
                (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'scheduled' AND substr(starts_at, 1, 10) > ?3 AND substr(starts_at, 1, 10) <= ?4) AS citas_proximos_7_dias,
                (SELECT COUNT(*) FROM consultations WHERE business_id = ?1 AND date >= ?2) AS consultas_mes,
                (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'no_show' AND starts_at >= ?2) AS inasistencias_mes`,
        bid, mes, hoy, addDays(hoy, 7));
      return { hoy, ...k };
    },
  },
];
