-- El informe de cada cita atendida: el plan entregado queda ligado a su cita (uno por cita).
ALTER TABLE patient_plans ADD COLUMN appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_plans_appointment ON patient_plans(appointment_id) WHERE appointment_id IS NOT NULL;
