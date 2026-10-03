# CD Nutrición

App web multi-tenant para consultorios de nutrición: pacientes, consultas (antropometría), agenda y archivos.

## Arquitectura

- **Un solo Cloudflare Worker** sirve la API (`/api/*`) y el panel (`/admin/*`, HTML estáticos en `public/`).
- **Frontend:** HTML sueltas + Bootstrap 5 + Bootstrap Icons + Vanilla JS. Sin build.
- **Backend:** router propio mínimo ([src/router.js](src/router.js)), validaciones en el Worker.
- **Datos:** D1 (SQLite), una sola base. Toda tabla de negocio lleva `business_id`; `tenantDb()` ([src/lib/db.js](src/lib/db.js)) rechaza SQL sin ese filtro y el valor sale siempre de la sesión.
- **Archivos:** R2, clave `<business_id>/<patient_id>/<uuid>`.
- **Seguridad:** Cloudflare Access (SSO / código por correo) → JWT verificado en el Worker → PIN propio (PBKDF2, bloqueo tras 5 fallos) → sesión en D1 con cookie HttpOnly. Las mutaciones exigen el encabezado `x-cdn: 1` (CSRF).
- **Integraciones:** WhatsApp vía Evolution API ([src/integrations/whatsapp.js](src/integrations/whatsapp.js)), correo vía SMTP de Gmail con sockets TCP ([src/integrations/email.js](src/integrations/email.js)).

```
src/
  index.js            entrada: API, páginas /admin, errores
  router.js           router con niveles de auth por ruta
  lib/                http, db (guardia de tenant), auth (Access + PIN + sesión), time
  api/                auth, dashboard, patients (+consultas), appointments, files, business (+equipo), super
  integrations/       whatsapp, email
public/admin/         login, index (dashboard), pacientes, cuerpo (Cuerpo Vivo), paciente (ficha), citas, ajustes, negocios
public/cv/            Cuerpo Vivo: CSS, HTML parcial y JS compartidos por la nutricionista y el paciente
public/p/             portal del paciente (/p/#<token>)
migrations/           esquema D1
scripts/seed.sql      datos de ejemplo (solo local)
docs/prototipo/       prototipo visual "Cuerpo Vivo"
```

### Cuerpo Vivo

Al abrir un paciente (desde Pacientes, Citas o Inicio) se abre `/admin/cuerpo?id=…`: figura animada, medidas con
estimación antropométrica, salud (exámenes, riesgos, lesiones, medicamentos), evolución y plan de alimentación.
La nutricionista puede cambiar a la vista *Paciente* para ver exactamente lo que ve el paciente.

Con **Enlace del paciente** se genera un enlace privado `/p/#<token>` (se guarda solo su SHA-256; crear uno nuevo
desactiva el anterior). El paciente ve su seguimiento sin usuario ni contraseña y puede marcar comidas, agua y metas.
El token viaja en el fragmento `#`, así que no queda en logs ni en el `Referer`.

**Access debe proteger solo `/admin` y `/api/admin`**: `/p/`, `/cv/` y `/api/p/` son públicos (el token protege los datos).

### Roles

| Nivel | Quién | Puede |
|---|---|---|
| `super` | correos en `SUPERADMIN_EMAILS` | crear/suspender negocios, entrar a cualquiera |
| `owner` | propietario del negocio | todo en su negocio, gestionar propietarios |
| `admin` | administrador | ajustes, equipo, borrar pacientes |
| `staff` | equipo | pacientes, consultas, citas, archivos |

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars        # pon tu correo en DEV_EMAIL y SUPERADMIN_EMAILS
npm run db:migrate:local
npm run db:seed:local                 # opcional: 2 negocios y 5 pacientes de ejemplo
npm run dev                           # http://localhost:8787/admin/
```

En local no hay Cloudflare Access: el Worker usa `DEV_EMAIL` como identidad. En producción, si `ACCESS_AUD` está definido, `DEV_EMAIL` se ignora.

## Despliegue (primera vez)

0. **Dominio:** Worker → Settings → Domains & Routes → Custom domain `cdnutricion.diwilo.com`.
1. **Crear recursos**
   ```bash
   npx wrangler d1 create cdnutricion          # copia el database_id a wrangler.jsonc
   npx wrangler r2 bucket create cdnutricion-files
   npm run db:migrate:remote
   ```
2. **Cloudflare Access** (Zero Trust → Access → Applications → Self-hosted)
   - Dominio `cdnutricion.diwilo.com`, rutas `/admin` y `/api/admin`.
   - Política *Allow* por correo o dominio (método: código por correo o SSO).
   - Copia el **Application Audience (AUD) Tag**.
3. **Secretos**
   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN   # miequipo.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD
   npx wrangler secret put SUPERADMIN_EMAILS
   npx wrangler secret put SMTP_USER            # opcional: correo Gmail
   npx wrangler secret put SMTP_PASS            # opcional: contraseña de aplicación
   npx wrangler secret put EVOLUTION_URL        # opcional
   npx wrangler secret put EVOLUTION_KEY        # opcional
   ```
4. **Migraciones:** en Workers Builds el paso `build` de `wrangler.jsonc` aplica las migraciones pendientes antes de desplegar.
5. **Workers Builds:** en el dashboard del Worker → Settings → Builds → conectar `diwilotech/cdnutricion`, rama `main`, comando de despliegue `npm run deploy` (aplica migraciones y despliega). Cada push a `main` despliega.

Al agregar un miembro al equipo, su correo también debe estar permitido en la política de Access.
