# CD Nutrición

App web multi-tenant para consultorios de nutrición: pacientes, consultas (antropometría), agenda y archivos.

## Arquitectura

- **Un solo Cloudflare Worker** sirve la API (`/api/*`) y el panel (`/admin/*`, HTML estáticos en `public/`).
- **Frontend:** HTML sueltas + Bootstrap 5 + Bootstrap Icons + Vanilla JS. Sin build.
- **Backend:** router propio mínimo ([src/router.js](src/router.js)), validaciones en el Worker.
- **Datos:** D1 (SQLite), una sola base. Toda tabla de negocio lleva `business_id`; `tenantDb()` ([src/lib/db.js](src/lib/db.js)) rechaza SQL sin ese filtro y el valor sale siempre de la sesión.
- **Archivos:** R2, clave `<business_id>/<patient_id>/<uuid>`.
- **Seguridad:** correo + contraseña (PBKDF2, bloqueo tras 5 fallos) → sesión en D1 con cookie HttpOnly. Las mutaciones exigen el encabezado `x-cdn: 1` (CSRF). Sin Cloudflare Access: el único panel protegido con Access es Diwilo Web.
- **Plataforma:** los negocios, sus propietarios y la suscripción se manejan desde **Diwilo Web** (`diwilo.com/admin`), que llama a `/api/platform/*` con `Authorization: Bearer PLATFORM_KEY` ([src/api/platform.js](src/api/platform.js)).
- **Suscripción:** `businesses.paid_until` (`YYYY-MM-DD`; vacío = sin límite). Si la fecha ya pasó, el consultorio queda en **solo lectura**: toda escritura responde 402 y el panel muestra un aviso rojo. Aplica también al portal del paciente.
- **Integraciones:** WhatsApp vía Evolution API ([src/integrations/whatsapp.js](src/integrations/whatsapp.js)), correo vía SMTP de Gmail con sockets TCP ([src/integrations/email.js](src/integrations/email.js)).

```
src/
  index.js            entrada: API, páginas /admin, errores
  router.js           router con niveles de auth por ruta
  lib/                http, db (guardia de tenant), auth (contraseña + sesión + suscripción), time
  api/                auth, dashboard, patients (+consultas), appointments, files, business (+equipo), platform (Diwilo)
  integrations/       whatsapp, email
public/admin/         login, index (dashboard), pacientes, cuerpo (Cuerpo Vivo), paciente (ficha), citas, ajustes
public/cv/            Cuerpo Vivo: CSS, HTML parcial y JS compartidos por la nutricionista y el paciente
public/p/             portal del paciente (/p/#<token>)
migrations/           esquema D1
scripts/seed.sql      datos de ejemplo (solo local)
docs/prototipo/       prototipo visual "Cuerpo Vivo"
```

### Multi-tenant por dirección

Cada consultorio vive en su propia ruta, igual que Control de Citas ([src/lib/tenant.js](src/lib/tenant.js)):

| Ruta | Qué es |
|---|---|
| `/<slug>` | página pública del consultorio (contacto, cómo entra el paciente) |
| `/<slug>/admin/…` | panel; la API recibe el consultorio en el encabezado `x-business` y valida la membresía |
| `/<slug>/p/#<token>` | seguimiento del paciente |
| `/admin/…` | redirige al consultorio de origen (Referer) o al de la sesión |

La dirección, la tarjeta y el logo **del consultorio** se administran desde **Diwilo Web** (para todos los negocios):

| Diwilo Web llama | Para |
|---|---|
| `PATCH /api/platform/businesses/:id { slug }` | cambiar la dirección; la anterior queda como alias y redirige (301) |
| `PATCH /api/platform/businesses/:id { card }` | tarjeta del consultorio: `specialty, bio, address, lat, lng, showMap, hours, links[]` |
| `POST /api/platform/businesses/:id/logo` (multipart `file`) · `DELETE …/logo` | logo del consultorio |
| `GET /api/platform/businesses[/:id]` | incluye `public_url`, `admin_url`, `logo_url` y `card` |

En el panel (**Ajustes**), las tarjetas se editan *sobre la misma tarjeta* ([public/admin/assets/card-editor.js](public/admin/assets/card-editor.js)):

- **Datos del negocio**: tarjeta del consultorio (logo, nombre, descripción, contacto, dirección, mapa, horario, redes). Propietario/administrador.
- **Equipo**: cada miembro como tarjeta de contacto; el lápiz abre su tarjeta (`/<slug>/<handle>`) para editarla ahí.
  Cada quien edita la suya; propietarios y administradores, la de cualquiera. Lo que se deje vacío se toma del negocio.

### Cuerpo Vivo

Al abrir un paciente (desde Pacientes, Citas o Inicio) se abre `/admin/cuerpo?id=…`: figura animada, medidas con
estimación antropométrica, salud (exámenes, riesgos, lesiones, medicamentos), evolución y plan de alimentación.
La nutricionista puede cambiar a la vista *Paciente* para ver exactamente lo que ve el paciente.

Con **Vista del paciente** se genera un enlace privado `/<slug>/p/#<token>` (el `id` es su SHA-256; el token también
se guarda para reusarlo en el QR y al volver a compartir; crear uno nuevo desactiva el anterior). El paciente ve su seguimiento sin usuario ni contraseña y puede marcar comidas, agua y metas.
El token viaja en el fragmento `#`, así que no queda en logs ni en el `Referer`.

`/p/`, `/cv/` y `/api/p/` son públicos (el token protege los datos).

**Informe de la consulta (PDF):** cada cita atendida tiene un botón PDF (en la Ficha y en la Agenda); **Imprimir plan**
hace lo mismo con la cita de hoy. Guarda en `patient_plans` el plan entregado ligado a su cita (de hoy: se actualiza al
reimprimir; pasada: queda fija) y abre `/admin/plan?v=<id>`, hoja carta con: cómo va (medidas de esa consulta frente a la
anterior y a la primera), últimos exámenes hasta ese día, comidas, metas, recomendaciones, lo que debe evitar y un QR
pequeño a su seguimiento (si el paciente no tiene enlace reutilizable, se le crea al generar el PDF); al reverso, la lista de intercambios.

### Roles

| Nivel | Quién | Puede |
|---|---|---|
| `owner` | propietario del negocio (**uno solo**, lo asigna Diwilo Web al crear el negocio) | todo en su negocio; no se puede quitar ni cambiar de rol desde el panel |
| `admin` | administrador | ajustes, equipo, borrar pacientes |
| `staff` | equipo | pacientes, consultas, citas, archivos |

Crear consultorios e invitar propietarios se hace desde Diwilo Web. Dentro del consultorio, un propietario o
administrador agrega a su equipo en **Ajustes → Equipo**: si la persona no tiene cuenta, se genera un link
`/#invite=<token>` (el login genérico vive en la raíz del dominio) para que cree su contraseña. El mismo botón genera un link nuevo si alguien la olvida.
Los PIN de antes siguen entrando una vez y piden crear la contraseña.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars        # PLATFORM_KEY para probar /api/platform
npm run db:migrate:local
npm run db:seed:local                 # opcional: 2 negocios y 5 pacientes de ejemplo
npm run dev                           # http://localhost:8787/admin/
```

Para tener un usuario en local, crea un negocio con `curl -X POST localhost:8787/api/platform/businesses -H "authorization: Bearer <PLATFORM_KEY>" -d '{"name":"Prueba","owner_email":"tu@correo.com","paid_until":null}'` y abre el `invite_path` que devuelve.

## Despliegue (primera vez)

0. **Dominio:** Worker → Settings → Domains & Routes → Custom domain `cdnutricion.diwilo.com`.
1. **Crear recursos**
   ```bash
   npx wrangler d1 create cdnutricion          # copia el database_id a wrangler.jsonc
   npx wrangler r2 bucket create cdnutricion-files
   npm run db:migrate:remote
   ```
2. **Sin Cloudflare Access:** si existía una aplicación de Access para `cdnutricion.diwilo.com`, bórrala
   (Zero Trust → Access → Applications). El login ahora es propio.
3. **Secretos**
   ```bash
   npx wrangler secret put PLATFORM_KEY         # el mismo valor que en Diwilo Web
   npx wrangler secret put SMTP_USER            # opcional: correo Gmail
   npx wrangler secret put SMTP_PASS            # opcional: contraseña de aplicación
   npx wrangler secret put EVOLUTION_URL        # opcional
   npx wrangler secret put EVOLUTION_KEY        # opcional
   ```
4. **Migraciones:** en Workers Builds el paso `build` de `wrangler.jsonc` aplica las migraciones pendientes antes de desplegar.
5. **Workers Builds:** en el dashboard del Worker → Settings → Builds → conectar `diwilotech/cdnutricion`, rama `main`, comando de despliegue `npm run deploy` (aplica migraciones y despliega). Cada push a `main` despliega.

