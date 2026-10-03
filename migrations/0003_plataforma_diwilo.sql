-- Acceso con correo + contraseña (sin Cloudflare Access) y suscripción manejada desde Diwilo Web.

-- 'YYYY-MM-DD' inclusive; NULL = sin límite. Vencida -> el negocio queda en solo lectura.
ALTER TABLE businesses ADD COLUMN paid_until TEXT;

-- SHA-256 del token del link para crear/restablecer la contraseña (/admin/login#invite=<token>).
ALTER TABLE users ADD COLUMN invite_hash TEXT;
CREATE INDEX idx_users_invite ON users(invite_hash);
