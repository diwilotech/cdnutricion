# CD Nutrición — guía rápida

Responde en español. Modo económico: sin capturas salvo que se pidan; de las pruebas mostrar solo el resumen.

## Qué es
App `cdnutricion` (cdnutricion.diwilo.com) para consultorios de nutrición. Cloudflare Workers + D1 `cdnutricion` + R2 `cdnutricion-files`, JS sin framework, Bootstrap. Publica con Workers Builds al hacer push a `main` (aplica migraciones). Usa la **arquitectura común de las apps Diwilo** (igual que CD Residentes y CD Academia).

## Mapa
- Direcciones: `/` ingreso (`public/admin/login.html`, con `#invite=`) · `/<slug>` tarjeta pública del consultorio (y `/<slug>/<usuario>` la de cada profesional) · `/<slug>/admin` panel (`public/staff/panel.html`: shell común + un marco `#dw-frame`) · `/staff/<modulo>.html` página de cada módulo (la carga el panel; abierta directo lleva al panel con `?go=`) · `/<slug>/p/#token` seguimiento del paciente (Cuerpo Vivo) · `/<slug>/admin/<sección>` (viejo) redirige al panel.
- `modulos.app.json`: módulos propios (`pacientes` = pacientes + consultas + Cuerpo Vivo + planes + archivos, `citas` = agenda, `ajustes` = consultorio, tarjeta, equipo con tarjetas, integraciones) y centrales (`finanzas`, `marketing`, `nomina`, `whatsapp`, `marca`, `ai`, `dashboard`=Inicio, de Diwilo Modulos por binding `MODULOS`; `src/lib/central.js`). Equipo es parte de la página de Ajustes (`#equipo`); `/staff/equipo` redirige allí.
- Auth: `src/lib/auth.js` → `authenticate(c, 'tenant:<modulo>' | 'manager:<modulo>' | 'session' | 'portal' | 'public' | 'platform')` comprueba sesión, rol, módulo activo (`business_modules`, lo asigna Diwilo por `src/api/platform-modules.js`), módulos por persona (`memberships.modulos`) y suscripción (vencida = solo lectura). CSRF: `x-app: 1` o `x-cdn: 1` en escrituras.
- Módulos propios: `src/api/<modulo>.js` con rutas `/api/admin/…` (patients, appointments, cuerpo, files, business=equipo, card, demo, dashboard=tablero/embudo/CSV). Las páginas usan `public/js/nutricion.js` (`Nut`/`App.*`: API, formatos, formularios; `window.DW_KEEP_APP` evita pisar el `App` común).
- Inicio: `public/staff/index.html` carga el Dashboard central y `public/js/pages/inicio.js` registra los widgets propios (consultorio de hoy, tablero con `dwviz`, embudo de citas, CSV).
- IA: herramientas propias en `src/ia/` (`nutricion.js` resumen en vivo, `control.js` declarativas que llaman a las mismas rutas de la API) + MCP en `src/api/mcp.js`.
- Contrato con Diwilo (NO tocar): `src/api/platform.js`, `src/lib/platform-rpc.js`, `export class Platform`, roles owner/admin/staff, `paid_until`, invitación por `/#invite=`.

## Comandos
- `npm run db:migrate:local && npm test` → «Todo bien» (levanta la app + Diwilo Modulos de la carpeta hermana; wrangler ≥ 4.151).
- `node scripts/ui-check.mjs` → recorre el panel en Chrome (CHROME=…); no es parte de `npm test`.
- Si las pruebas dan 500 en `/m/*`: wrangler viejo (actualizar) o `pkill -f workerd`.

## Reglas
- Toda consulta filtra por negocio (`tenantDb`). Vencida = solo lectura.
- Migraciones nuevas: solo agregar, preservar datos.
- Publicar Diwilo Modulos antes que esta app.
