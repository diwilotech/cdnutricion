-- Tarjeta digital del consultorio (/<slug>): foto de perfil en R2 y datos de la tarjeta.
ALTER TABLE businesses ADD COLUMN logo_key TEXT;
-- JSON: { specialty, bio, address, lat, lng, showMap, hours, links: [{ label, url }] }
ALTER TABLE businesses ADD COLUMN card TEXT;
