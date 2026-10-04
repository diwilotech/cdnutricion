-- Planes entregados: copia fija del plan cada vez que se imprime o se entrega al paciente.
-- El plan vivo sigue en patient_profiles.plan; aquí queda el historial (qué se le dio y cuándo).
CREATE TABLE patient_plans (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,              -- JSON { meals, goals, inter, agua }
  recs        TEXT,                       -- JSON [texto, …] recomendaciones vigentes al entregarlo
  weight_kg   REAL,                       -- último peso registrado al entregarlo
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_plans_patient ON patient_plans(business_id, patient_id, created_at);

-- El enlace del paciente se guarda para poder reusarlo (QR del plan impreso, volver a compartir)
-- sin dejar sin acceso al paciente cada vez. Da acceso solo a datos que el panel ya muestra.
ALTER TABLE portal_links ADD COLUMN token TEXT;
