-- Direcciones anteriores de cada consultorio: al cambiar /<slug>, los enlaces viejos redirigen al nuevo.
CREATE TABLE business_slug_aliases (
  slug        TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_slug_aliases_business ON business_slug_aliases(business_id);

-- El consultorio de producción ya había cambiado de /mateo-londono a /matthew antes de existir los alias.
-- (En otras bases no hace nada.)
INSERT OR IGNORE INTO business_slug_aliases (slug, business_id)
  SELECT 'mateo-londono', id FROM businesses WHERE id = '752e4775-62ac-4f35-a9cf-778663d5a769' AND slug <> 'mateo-londono';
