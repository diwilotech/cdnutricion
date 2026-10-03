-- Esquema inicial multi-tenant.
-- Toda tabla de datos de negocio lleva business_id y se filtra SIEMPRE por él.

CREATE TABLE businesses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  email       TEXT,
  phone       TEXT,
  timezone    TEXT NOT NULL DEFAULT 'America/Bogota',
  wa_instance TEXT,                         -- instancia de Evolution API
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,      -- identidad que entrega Cloudflare Access
  name          TEXT,
  pin_hash      TEXT,
  pin_salt      TEXT,
  failed_pins   INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  is_superadmin INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memberships (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX idx_memberships_business ON memberships(business_id);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,             -- SHA-256 del token de la cookie
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE patients (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL DEFAULT '',
  doc_id      TEXT,
  sex         TEXT CHECK (sex IN ('F','M') OR sex IS NULL),
  birth_date  TEXT,
  phone       TEXT,
  email       TEXT,
  height_cm   REAL,
  goal        TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_patients_business ON patients(business_id, status, last_name);

CREATE TABLE appointments (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id   TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  starts_at    TEXT NOT NULL,               -- 'YYYY-MM-DDTHH:MM' en la zona horaria del negocio
  duration_min INTEGER NOT NULL DEFAULT 45,
  kind         TEXT NOT NULL DEFAULT 'control' CHECK (kind IN ('primera','control','virtual')),
  status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled','no_show')),
  notes        TEXT,
  reminded_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_appointments_business ON appointments(business_id, starts_at);
CREATE INDEX idx_appointments_patient ON appointments(business_id, patient_id);

CREATE TABLE consultations (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id   TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,               -- 'YYYY-MM-DD'
  weight_kg    REAL,
  fat_pct      REAL,
  muscle_pct   REAL,
  measures     TEXT,                        -- JSON con circunferencias, pliegues, vitales…
  notes        TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_consultations_patient ON consultations(business_id, patient_id, date);

CREATE TABLE files (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id   TEXT REFERENCES patients(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  content_type TEXT,
  size         INTEGER,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_files_patient ON files(business_id, patient_id);
