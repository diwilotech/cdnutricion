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

  // ---- Tres casos que empeoran: leve → moderado → grave (el historial también va en aumento) ----
  { first: 'Valentina', last: 'Ríos', sex: 'F', birth: '1992-05-18', h: 162, phone: '3011234567', goal: 'Frenar el aumento de peso',
    hist: [[68, 31, 25], [68.8, 31.8, 24.8], [69.6, 32.5, 24.4], [70.5, 33.2, 24], [71.5, 34, 23.5]],
    measures: { cintura: 84, abdomen: 90, cadera: 102, brazoR: 30, pas: 124, pad: 80, fc: 78, glu: 98, visceral: 8, agua: 46 },
    appt: [2, '17:00', 'control'],
    clinical: { riesgos: [{ k: 'metab', lv: 1, nota: 'Subió 3,5 kg en 4 meses y la grasa va en aumento' }],
      antecedentes: ['Madre con hipertensión'], habitos: ['Sedentaria desde que cambió de trabajo', 'Duerme 6 horas', 'Come fuera 3 veces por semana'] },
    labs: [[150, { col: 198, ldl: 122, hdl: 52, tg: 140, glu: 94, vitd: 27 }], [20, { col: 214, ldl: 136, hdl: 48, tg: 168, glu: 99, vitd: 22 }]],
    rec: 'Estamos a tiempo: volvamos a 3 caminatas de 40 minutos y cenas sin harina entre semana.' },
  { first: 'Ricardo', last: 'Mejía', sex: 'M', birth: '1977-09-03', h: 175, phone: '3022345678', goal: 'Bajar de peso y controlar presión y azúcar',
    hist: [[98, 31, 30], [99.5, 32, 29.6], [100.8, 32.8, 29.2], [102, 33.6, 28.8], [103.2, 34.3, 28.4], [104.5, 35, 28]],
    measures: { cintura: 112, abdomen: 118, cadera: 108, cuello: 44, pas: 138, pad: 90, fc: 84, glu: 118, visceral: 17, agua: 47 },
    appt: [3, '07:30', 'control'],
    clinical: {
      riesgos: [{ k: 'cv', lv: 2, nota: 'Hipertensión, LDL alto, HDL bajo y fuma' }, { k: 'metab', lv: 2, nota: 'Prediabetes en ascenso (HbA1c 6,3 %)' },
        { k: 'hep', lv: 1, nota: 'Triglicéridos altos: probable hígado graso' }],
      cond: [{ n: 'Hipertensión arterial', d: '2024' }, { n: 'Prediabetes', d: '2025' }, { n: 'Dislipidemia', d: '2025' }],
      meds: [{ n: 'Losartán', dosis: '50 mg', h: 'Mañana', para: 'Presión arterial' }],
      lesiones: [{ z: 'rodI', n: 'Dolor por sobrecarga', lv: 1, d: '2025' }],
      alergias: ['Ninguna conocida'], antecedentes: ['Padre con infarto a los 58 años'],
      habitos: ['Fuma 10 cigarrillos al día', 'Cerveza los fines de semana', 'Comidas rápidas 4 veces por semana'] },
    labs: [[160, { col: 226, ldl: 148, hdl: 40, tg: 210, glu: 108, hba1c: 6.0, urico: 7.2, creat: 1.1 }],
      [20, { col: 241, ldl: 160, hdl: 36, tg: 265, glu: 121, hba1c: 6.3, urico: 7.9, creat: 1.2, tfg: 78 }]],
    rec: 'Prioridad: dejar de fumar y cortar la cerveza. Proteína en cada comida y harinas medidas.' },
  { first: 'Gloria', last: 'Patiño', sex: 'F', birth: '1963-01-27', h: 156, phone: '3033456789', goal: 'Compensar la diabetes y proteger el riñón',
    hist: [[96, 44, 20], [97.4, 44.6, 19.6], [98.8, 45.2, 19.2], [100.2, 45.8, 18.8], [101.6, 46.4, 18.4], [103, 47, 18]],
    measures: { cintura: 121, abdomen: 128, cadera: 128, cuello: 41, brazoR: 38, pantorrilla: 42, pas: 158, pad: 96, fc: 92, glu: 168, visceral: 22, agua: 40, edadMet: 78 },
    appt: [1, '08:30', 'control'],
    clinical: {
      riesgos: [{ k: 'metab', lv: 2, nota: 'Diabetes tipo 2 descompensada (HbA1c 8,6 %)' }, { k: 'renal', lv: 2, nota: 'Enfermedad renal 3b y potasio alto' },
        { k: 'cv', lv: 2, nota: 'Hipertensión no controlada, LDL alto y obesidad' }, { k: 'resp', lv: 1, nota: 'Apnea del sueño' }],
      cond: [{ n: 'Diabetes tipo 2', d: '2018' }, { n: 'Hipertensión arterial', d: '2012' }, { n: 'Enfermedad renal crónica, estadio 3b', d: '2025' },
        { n: 'Obesidad grado III', d: '2020' }, { n: 'Apnea obstructiva del sueño', d: '2023' }],
      meds: [{ n: 'Insulina glargina', dosis: '20 UI', h: 'Noche', para: 'Diabetes' }, { n: 'Metformina', dosis: '850 mg', h: 'Almuerzo', para: 'Diabetes (revisar por riñón)' },
        { n: 'Losartán', dosis: '100 mg', h: 'Mañana', para: 'Presión y riñón' }, { n: 'Amlodipino', dosis: '10 mg', h: 'Mañana', para: 'Presión arterial' },
        { n: 'Atorvastatina', dosis: '40 mg', h: 'Noche', para: 'Colesterol' }, { n: 'Furosemida', dosis: '40 mg', h: 'Mañana', para: 'Retención de líquidos' }],
      lesiones: [{ z: 'rodD', n: 'Artrosis', lv: 2, d: '2019' }, { z: 'rodI', n: 'Artrosis', lv: 1, d: '2021' }, { z: 'lumbar', n: 'Lumbalgia crónica', lv: 1, d: '2022' }],
      alergias: ['Sulfas'], antecedentes: ['Madre con diabetes y amputación de pie'],
      habitos: ['Casi no camina por dolor de rodillas', 'Toma gaseosa a diario', 'Duerme mal por la apnea'] },
    labs: [[240, { col: 238, ldl: 152, hdl: 38, tg: 240, glu: 148, hba1c: 7.4, creat: 1.3, tfg: 52, bun: 24, urico: 7.4, k: 4.9, hb: 11.8, vitd: 16 }],
      [120, { col: 246, ldl: 160, hdl: 36, tg: 270, glu: 158, hba1c: 7.9, creat: 1.45, tfg: 44, bun: 28, urico: 7.9, k: 5.2, hb: 11.4, vitd: 15 }],
      [20, { col: 256, ldl: 168, hdl: 34, tg: 298, glu: 171, hba1c: 8.6, creat: 1.62, tfg: 38, bun: 31, urico: 8.4, k: 5.5, hb: 11.1, vitd: 14, tsh: 3.8 }]],
    rec: 'Caso prioritario: cero gaseosa, harinas en porción medida y frutas bajas en potasio. Coordinar con su médico el ajuste de metformina por el riñón.' },
];

export function routes(r) {
  r.post('/api/admin/demo', 'manager', async (c) => {
    const db = tenantDb(c);
    const bid = c.businessId;
    // Crea solo los que falten: así se pueden sumar ejemplos nuevos sin duplicar los anteriores.
    const have = new Set((await db.all(`SELECT doc_id FROM patients WHERE business_id = ? AND doc_id LIKE 'DEMO-%'`, bid)).map((x) => x.doc_id));
    if (have.size >= DEMO.length) throw new HttpError(409, 'Ya están todos los pacientes de ejemplo.');
    const today = localNow(c.timezone).date;
    const stmts = [];
    let created = 0;
    DEMO.forEach((d, i) => {
      if (have.has(`DEMO-${i + 1}`)) return;
      created++;
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
      const labs = !d.labs ? [] : Array.isArray(d.labs) ? d.labs : [[20, d.labs]];
      for (const [daysAgo, vals] of labs) {
        stmts.push(db.prepare(
          'INSERT INTO patient_labs (id, business_id, patient_id, date, vals, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          uuid(), bid, pid, addDays(today, -daysAgo), JSON.stringify(vals), c.user.id,
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
    return json({ ok: true, patients: created }, 201);
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
