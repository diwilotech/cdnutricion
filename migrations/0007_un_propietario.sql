-- Un solo propietario por negocio: el que se asigna al crearlo en Diwilo Web.
-- Si ya había varios, se conserva el más antiguo y los demás pasan a administrador.
UPDATE memberships SET role = 'admin'
 WHERE role = 'owner'
   AND rowid NOT IN (
     SELECT MIN(rowid) FROM memberships m2
      WHERE m2.role = 'owner' AND m2.created_at = (
        SELECT MIN(created_at) FROM memberships m3 WHERE m3.business_id = m2.business_id AND m3.role = 'owner')
      GROUP BY m2.business_id);
CREATE UNIQUE INDEX idx_memberships_one_owner ON memberships(business_id) WHERE role = 'owner';
