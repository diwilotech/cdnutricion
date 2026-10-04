// Pacientes de ejemplo para conocer la app: historial de consultas, citas para los próximos días,
// historia clínica, exámenes y recomendaciones. Se marcan con doc_id 'DEMO-…' y se pueden borrar.
import { json, HttpError } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { localNow, addDays } from '../lib/time.js';

const DEMO = [
  { first: 'María', last: 'Gómez', sex: 'F', birth: '1992-03-14', h: 168, phone: '3001112233', goal: 'Bajar grasa y ganar músculo',
    hist: [[82, 36, 24], [80, 34.5, 24.8], [77.5, 33, 25.5], [75.5, 31.5, 26.3], [74, 30, 27]],
    measures: { cintura: 86, cadera: 108, abdomen: 92, brazoR: 31, pas: 118, pad: 76, glu: 92, visceral: 7 },
    appt: [1, '09:00', 'control'],
    clinical: { antecedentes: ['Madre con hipertensión'], habitos: ['No fuma', 'Fuerza 2 veces por semana'] },
    labs: { col: 195, ldl: 118, hdl: 55, tg: 128, glu: 92, hb: 13.4, vitd: 31 },
    rec: 'Vas muy bien: bajaste 8 kg en 4 meses. Mantén la proteína en el desayuno, te está ayudando a ganar músculo.' },
  { first: 'Andrés', last: 'Ruiz', sex: 'M', birth: '1985-06-02', h: 178, phone: '3002223344', goal: 'Bajar de peso y reducir azúcar',
    hist: [[96, 30, 31], [94, 28.5, 31.8], [92, 27, 32.5], [90.5, 25.5, 33.4], [89, 24, 34]],
    measures: { cintura: 98, cadera: 104, pas: 128, pad: 84, glu: 101 },
    appt: [1, '16:30', 'control'],
    clinical: { riesgos: [{ k: 'metab', lv: 1, nota: 'Hígado graso y triglicéridos altos' }], cond: [{ n: 'Hígado graso no alcohólico', d: '2025' }],
      alergias: ['Penicilina'], antecedentes: ['Padre con diabetes tipo 2'], habitos: ['Trabajo de oficina, sedentario'] },
    labs: { col: 210, ldl: 132, hdl: 41, tg: 190, glu: 101, hba1c: 5.9, urico: 7.1 },
    rec: 'Reduce las bebidas azucaradas entre semana; cámbialas por agua con limón.' },
  { first: 'Laura', last: 'Méndez', sex: 'F', birth: '1999-01-20', h: 160, phone: '3003334455', goal: 'Mantenimiento y rendimiento',
    hist: [[56, 25, 26.5], [55.5, 24.5, 27], [55, 24, 27.3], [55.2, 23.5, 27.8], [55, 23, 28]],
    measures: { cintura: 68, cadera: 94, pas: 110, pad: 70, glu: 85 },
    appt: [2, '08:00', 'virtual'],
    clinical: { cond: [{ n: 'Anemia ferropénica', d: '2026' }], meds: [{ n: 'Sulfato ferroso', dosis: '300 mg', h: 'En ayunas', para: 'Anemia' }],
      alergias: ['Intolerancia a la lactosa'], habitos: ['Corre 3 veces por semana'] },
    labs: { hb: 11.8, vitd: 23, glu: 85, tsh: 2.3 },
    rec: 'Estás en rango saludable. Toma el hierro lejos del café y acompáñalo con fruta rica en vitamina C.' },
  { first: 'Carlos', last: 'Ortiz', sex: 'M', birth: '1974-08-11', h: 172, phone: '3004445566', goal: 'Controlar glucosa y grasa visceral',
    hist: [[92, 32, 28.5], [91, 31.5, 29], [90, 30.5, 29.3], [89, 29.8, 29.8], [88, 29, 30]],
    measures: { cintura: 104, cadera: 103, pas: 136, pad: 88, glu: 108, visceral: 15 },
    appt: [3, '11:00', 'control'],
    clinical: { riesgos: [{ k: 'cv', lv: 2, nota: 'Fuma, LDL alto y padre con infarto' }, { k: 'resp', lv: 1, nota: 'Fumador activo' }],
      cond: [{ n: 'Hipertensión arterial', d: '2021' }], meds: [{ n: 'Losartán', dosis: '50 mg', h: 'Mañana', para: 'Presión arterial' }],
      lesiones: [{ z: 'lumbar', n: 'Lumbalgia', lv: 1, d: '2025' }], habitos: ['Fuma 5 cigarrillos al día', 'Duerme 5 horas'] },
    labs: { col: 232, ldl: 155, hdl: 39, tg: 188, glu: 108 },
    rec: null },
  { first: 'Jorge', last: 'Ramírez', sex: 'M', birth: '1958-02-05', h: 170, phone: '3005556677', goal: 'Cuidado renal y bajar grasa',
    hist: [[85, 31.5, 28.5], [84.2, 31, 28.8], [83.5, 30.8, 29], [82.8, 30.4, 29.2], [82, 30, 29.5]],
    measures: { cintura: 102, cadera: 101, pas: 142, pad: 86, glu: 106, visceral: 16 },
    appt: [4, '15:30', 'control'],
    clinical: { riesgos: [{ k: 'renal', lv: 2, nota: 'Enfermedad renal 3a y potasio alto' }, { k: 'cv', lv: 2, nota: 'Hipertensión, LDL alto y edad' }],
      cond: [{ n: 'Enfermedad renal crónica, estadio 3a', d: '2024' }, { n: 'Prediabetes', d: '2025' }],
      meds: [{ n: 'Losartán', dosis: '50 mg', h: 'Mañana', para: 'Presión y riñón' }, { n: 'Metformina', dosis: '500 mg', h: 'Almuerzo', para: 'Prediabetes' }],
      lesiones: [{ z: 'rodD', n: 'Artrosis', lv: 1, d: '2022' }], antecedentes: ['Padre con infarto a los 70 años'] },
    labs: { col: 228, ldl: 150, hdl: 41, glu: 106, hba1c: 6.0, creat: 1.55, tfg: 48, k: 5.1, vitd: 24 },
    rec: 'Moderemos la proteína y prefiere frutas bajas en potasio: manzana, pera, fresas y piña.' },
  { first: 'Sofía', last: 'Castro', sex: 'F', birth: '2001-11-30', h: 164, phone: '3006667788', goal: 'Primera consulta: hábitos y energía',
    hist: [], measures: {}, appt: [5, '10:00', 'primera'], clinical: null, labs: null, rec: null },
  { first: 'Daniel', last: 'Herrera', sex: 'M', birth: '1990-07-22', h: 181, phone: '3007778899', goal: 'Ganar masa muscular',
    hist: [[72, 16, 38], [73.5, 16.5, 38.6], [74.8, 16.8, 39.2]],
    measures: { cintura: 80, cadera: 95, brazoC: 36, pas: 116, pad: 72 },
    appt: [6, '18:00', 'control'], clinical: { habitos: ['Entrena fuerza 5 veces por semana'] }, labs: null,
    rec: 'Sube a 1,8 g de proteína por kg y agrega un refrigerio antes de entrenar.' },
];

export function routes(r) {
  r.post('/api/admin/demo', 'manager', async (c) => {
    const db = tenantDb(c);
    const bid = c.businessId;
    const exists = await db.first(`SELECT COUNT(*) AS n FROM patients WHERE business_id = ? AND doc_id LIKE 'DEMO-%'`, bid);
    if (exists.n) throw new HttpError(409, 'Ya hay pacientes de ejemplo. Bórralos primero si quieres crearlos de nuevo.');
    const today = localNow(c.timezone).date;
    const stmts = [];
    DEMO.forEach((d, i) => {
      const pid = uuid();
      stmts.push(db.prepare(
        `INSERT INTO patients (id, business_id, first_name, last_name, doc_id, sex, birth_date, phone, height_cm, goal, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        pid, bid, d.first, d.last, `DEMO-${i + 1}`, d.sex, d.birth, d.phone, d.h, d.goal, 'Paciente de ejemplo: se borra desde Ajustes.',
      ));
      // Consultas mensuales que terminan hace ~2 semanas, con la cita atendida de cada una.
      d.hist.forEach(([w, f, m], j) => {
        const date = addDays(today, -14 - (d.hist.length - 1 - j) * 28);
        const last = j === d.hist.length - 1;
        stmts.push(db.prepare(
          `INSERT INTO consultations (id, business_id, patient_id, date, weight_kg, fat_pct, muscle_pct, measures, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uuid(), bid, pid, date, w, f, m, last && Object.keys(d.measures).length ? JSON.stringify(d.measures) : null, c.user.id,
        ));
        stmts.push(db.prepare(
          `INSERT INTO appointments (id, business_id, patient_id, starts_at, kind, status) VALUES (?, ?, ?, ?, ?, 'done')`,
          uuid(), bid, pid, `${date}T${d.appt[1]}`, j === 0 ? 'primera' : 'control',
        ));
      });
      // Próxima cita en los próximos días.
      stmts.push(db.prepare(
        `INSERT INTO appointments (id, business_id, patient_id, starts_at, kind, status, notes) VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`,
        uuid(), bid, pid, `${addDays(today, d.appt[0])}T${d.appt[1]}`, d.appt[2], d.appt[2] === 'primera' ? 'Traer exámenes recientes' : null,
      ));
      if (d.clinical) {
        stmts.push(db.prepare(
          'INSERT INTO patient_profiles (patient_id, business_id, clinical) VALUES (?, ?, ?)',
          pid, bid, JSON.stringify({ lesiones: [], riesgos: [], cond: [], meds: [], alergias: [], antecedentes: [], habitos: [], ...d.clinical }),
        ));
      }
      if (d.labs) {
        stmts.push(db.prepare(
          'INSERT INTO patient_labs (id, business_id, patient_id, date, vals, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          uuid(), bid, pid, addDays(today, -20), JSON.stringify(d.labs), c.user.id,
        ));
      }
      if (d.rec) {
        stmts.push(db.prepare(
          'INSERT INTO recommendations (id, business_id, patient_id, text, author_id) VALUES (?, ?, ?, ?, ?)',
          uuid(), bid, pid, d.rec, c.user.id,
        ));
      }
    });
    await db.batch(stmts);
    return json({ ok: true, patients: DEMO.length }, 201);
  });

  // Borra los pacientes de ejemplo con todo lo suyo.
  r.delete('/api/admin/demo', 'manager', async (c) => {
    const db = tenantDb(c);
    const bid = c.businessId;
    const sub = `(SELECT id FROM patients WHERE business_id = ? AND doc_id LIKE 'DEMO-%')`;
    const files = await db.all(`SELECT r2_key FROM files WHERE business_id = ? AND patient_id IN ${sub}`, bid, bid);
    if (files.length) await c.env.FILES.delete(files.map((f) => f.r2_key));
    const tables = ['files', 'consultations', 'appointments', 'patient_labs', 'recommendations', 'patient_profiles', 'patient_logs', 'portal_links'];
    const res = await db.batch([
      ...tables.map((t) => db.prepare(`DELETE FROM ${t} WHERE business_id = ? AND patient_id IN ${sub}`, bid, bid)),
      db.prepare(`DELETE FROM patients WHERE business_id = ? AND doc_id LIKE 'DEMO-%'`, bid),
    ]);
    return json({ ok: true, deleted: res.at(-1).meta.changes });
  });
}
