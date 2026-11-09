// Prueba de punta a punta en local: Diwilo (simulado) crea negocios por RPC y se recorre la app completa.
// Uso: npm run db:migrate:local && npm test   (usa Diwilo Modulos de la carpeta hermana para los módulos centrales)
import { startApp, check, failures, diwilo, client, newBusiness, newMember } from './test-helpers.mjs';

await startApp();

try {
  const A = await newBusiness('Consultorio A', { login: true });
  const app = A.app, bid = A.id, slug = A.created.data.slug;
  check('Diwilo crea un consultorio por RPC', A.created.status === 201 && A.created.data.invite_path);
  check('Desde internet /api/platform da 401', (await client()('/api/platform/businesses')).status === 401);
  check('Desde internet /api/platform/modules da 401', (await client()('/api/platform/modules')).status === 401);
  const cat = await diwilo('GET', '/modules');
  check('Diwilo lee el catálogo de módulos (propios y centrales)', cat.status === 200 && ['pacientes', 'citas', 'ajustes'].every((id) => cat.data.modulos?.some((m) => m.id === id)), JSON.stringify(cat.data).slice(0, 200));

  // --- Shell ---
  const me = await app('/api/me');
  check('/api/me trae rol, tema y módulos propios', me.data.role === 'owner' && me.data.settings?.tema && ['pacientes', 'citas', 'ajustes'].every((id) => me.data.modules?.some((m) => m.id === id)), JSON.stringify(me.data).slice(0, 200));
  check('Los módulos centrales base (Inicio, Marca, IA) aparecen siempre', ['dashboard', 'marca', 'ai'].every((id) => me.data.modules.some((m) => m.id === id)));
  check('/staff/ sin sesión redirige al ingreso', (await client()('/staff/')).status === 302);
  check('/ con sesión lleva al panel (/<dirección>/admin/)', (await app('/')).headers.get('location')?.endsWith(`/${slug}/admin/`));
  const panel = await app(`/${slug}/admin`);
  check('/<dirección>/admin con sesión sirve el panel con el marco', panel.status === 200 && panel.data.text?.includes('id="dw-frame"'), String(panel.status));
  check('/<dirección>/admin sin sesión lleva al ingreso', (await client()(`/${slug}/admin`)).status === 302);
  check('/<dirección> sigue siendo la tarjeta pública', (await client()(`/${slug}`)).status === 200);
  check('El panel se puede cargar en un marco del mismo sitio', panel.headers.get('x-frame-options') === 'SAMEORIGIN');
  const doc = await app('/staff/pacientes.html', { headers: { 'sec-fetch-dest': 'document' } });
  check('Una página abierta directo lleva al panel con ?go=', doc.status === 302 && doc.headers.get('location')?.includes(`/${slug}/admin/?go=`), doc.headers.get('location'));
  check('/<dirección>/admin/pacientes (enlace viejo) lleva al panel con la página', (await app(`/${slug}/admin/pacientes`)).headers.get('location')?.includes('go=%2Fstaff%2Fpacientes.html'));
  check('Escritura sin encabezado de seguridad se rechaza (CSRF)', (await app('/api/admin/patients', { method: 'POST', body: { first_name: 'x' }, headers: { 'x-app': '', 'x-cdn': '' } })).status === 403);
  for (const m of ['pacientes', 'citas', 'ajustes', 'cuerpo', 'plan', 'equipo', 'index']) {
    const r = await app(`/staff/${m === 'index' ? '' : m}`, { headers: { 'sec-fetch-dest': 'iframe' } });
    check(`Página /staff/${m} sirve`, r.status === 200, String(r.status));
  }
  const ini = await app('/staff/', { headers: { 'sec-fetch-dest': 'iframe' } });
  check('El Inicio trae el shell y la ayuda de Nutrición', ini.data.text?.includes('id="dw-shell"') && ini.data.text.includes('/js/nutricion.js'));

  // --- Pacientes, consultas, agenda ---
  const P = await app('/api/admin/patients', { method: 'POST', body: { first_name: 'María', last_name: 'Gómez', phone: '3001112233' } });
  check('Crea un paciente', P.status === 201 && P.data.id, JSON.stringify(P.data));
  const K = await app(`/api/admin/patients/${P.data.id}/consultations`, { method: 'POST', body: { date: '2026-09-01', weight_kg: 80, height_cm: 165 } });
  const K2 = await app(`/api/admin/patients/${P.data.id}/consultations`, { method: 'POST', body: { date: '2026-10-01', weight_kg: 77 } });
  check('Registra dos consultas', K.status === 201 && K2.status === 201, JSON.stringify(K.data));
  const ap = await app('/api/admin/appointments', { method: 'POST', body: { patient_id: P.data.id, starts_at: '2026-11-20T10:00', kind: 'control' } });
  check('Agenda una cita', ap.status === 201 && ap.data.id, JSON.stringify(ap.data));
  const st = await app(`/api/admin/appointments/${ap.data.id}/status`, { method: 'POST', body: { status: 'done' } });
  check('Cambia el estado de la cita (embudo)', st.status === 200);
  const bad = await app(`/api/admin/appointments/${ap.data.id}/status`, { method: 'POST', body: { status: 'raro' } });
  check('Un estado inválido se rechaza', bad.status === 400);
  const tb = await app('/api/admin/tablero');
  check('El tablero responde con meses, asistencia y avance', tb.status === 200 && tb.data.meses?.length === 6 && tb.data.avance?.some((x) => x.kg === 3), JSON.stringify(tb.data).slice(0, 300));
  const emb = await app('/api/admin/embudo');
  check('El embudo de citas responde', emb.status === 200 && Array.isArray(emb.data.items));
  const csv = await app('/api/admin/export/pacientes');
  check('Exporta pacientes a CSV', csv.status === 200 && csv.data.text?.includes('María'), String(csv.status));
  check('Una exportación desconocida da 404', (await app('/api/admin/export/otra')).status === 404);

  // --- Módulos por persona y por plan ---
  const st1 = await newMember(bid, 'staff');
  check('Personal sin asignación ve pacientes y agenda', (await st1.app('/api/admin/patients')).status === 200);
  const team = (await app('/api/admin/team')).data;
  const stu = team.items.find((u) => u.role === 'staff');
  check('El equipo trae el catálogo de módulos asignables', team.catalogo?.length > 0 && stu?.modulos?.includes('pacientes'));
  const pm = await app(`/api/admin/team/${stu.id}`, { method: 'PATCH', body: { modulos: ['citas'] } });
  check('Se cambian los módulos de una persona', pm.status === 200);
  check('Sin el módulo, la API de pacientes da 403', (await st1.app('/api/admin/patients')).status === 403);
  check('Con el módulo, la agenda responde', (await st1.app('/api/admin/appointments')).status === 200);
  const off = await diwilo('PUT', `/businesses/${bid}/modules`, { modules: [{ modulo: 'pacientes', activo: true }], version: 'v1' });
  check('Diwilo asigna módulos al consultorio', off.status === 200, JSON.stringify(off.data).slice(0, 200));
  check('Con la agenda desactivada por plan, su API da 403', (await app('/api/admin/appointments')).status === 403);
  check('Los pacientes siguen activos', (await app('/api/admin/patients')).status === 200);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
console.log(failures() ? `\n✗ ${failures()} falla(s)` : '\nTodo bien');
process.exit(failures() ? 1 : 0);
