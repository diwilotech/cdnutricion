-- Tarjeta por profesional: /<slug>/<handle>. Vive en la membresía (una persona puede
-- tener una tarjeta distinta en cada consultorio donde trabaja).
ALTER TABLE memberships ADD COLUMN handle TEXT;
ALTER TABLE memberships ADD COLUMN photo_key TEXT;
-- JSON: { displayName, specialty, bio, phone, email, links: [{ label, url }] }
ALTER TABLE memberships ADD COLUMN card TEXT;
CREATE UNIQUE INDEX idx_memberships_handle ON memberships(business_id, handle);
