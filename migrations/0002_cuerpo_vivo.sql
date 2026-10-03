-- Cuerpo Vivo: historia clínica, plan, exámenes, recomendaciones, registro diario y portal del paciente.

-- Un perfil por paciente. Documentos JSON que edita la vista Cuerpo Vivo:
--   clinical: riesgos, diagnósticos, lesiones, medicamentos, alergias, antecedentes, hábitos (nutricionista)
--   plan:     tiempos de comida, metas, meta de agua, lista de intercambios (nutricionista)
--   tracking: uso de metas (paciente y nutricionista)
CREATE TABLE patient_profiles (
  patient_id  TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  clinical    TEXT,
  plan        TEXT,
  tracking    TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_profiles_business ON patient_profiles(business_id);

CREATE TABLE patient_labs (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  vals        TEXT NOT NULL,              -- JSON { col: 195, ldl: 118, … }
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_labs_patient ON patient_labs(business_id, patient_id, date);

CREATE TABLE recommendations (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recs_patient ON recommendations(business_id, patient_id, created_at);

-- Registro del día (tiempos de comida cumplidos, vasos de agua).
CREATE TABLE patient_logs (
  patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,              -- 'YYYY-MM-DD'
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (patient_id, day)
);
CREATE INDEX idx_logs_business ON patient_logs(business_id, patient_id, day);

-- Enlace privado del paciente (/p/#<token>). Se guarda solo el SHA-256 del token.
CREATE TABLE portal_links (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at  TEXT
);
CREATE INDEX idx_portal_patient ON portal_links(business_id, patient_id);
