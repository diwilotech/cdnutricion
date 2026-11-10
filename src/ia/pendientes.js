// Pendientes del consultorio para la IA proactiva (botón «IA Diwilo» → «Lo de hoy»). Los pide el módulo central de IA por
// ctx.propias.pendientes() (src/lib/central.js). Sin IA: usa las mismas herramientas de lectura del MCP (`usar` respeta módulo activo y rol).
// Cada uno: { id, nivel: mala|aviso|info, icono, texto, ruta, pregunta } — `pregunta` es lo que la persona le pediría a la IA para atenderlo.
const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export async function pendientesDe(usar) {
  const r = await usar('pacientes.resumen_en_vivo');
  if (!r) return [];
  const out = [];
  if (r.inasistencias_mes > 0) out.push({ id: 'cn-inasistencias', nivel: 'aviso', icono: 'bi-person-x', texto: `${pl(r.inasistencias_mes, 'paciente faltó', 'pacientes faltaron')} a su cita este mes`, ruta: '/staff/citas.html', pregunta: '¿Quién faltó este mes y cómo lo reagendo?' });
  if (r.citas_hoy > 0) out.push({ id: 'cn-hoy', nivel: 'info', icono: 'bi-calendar2-check', texto: `Hoy hay ${pl(r.citas_hoy, 'cita', 'citas')} y ${r.citas_proximos_7_dias || 0} más en los próximos 7 días`, ruta: '/staff/citas.html', pregunta: '¿A quién atiendo hoy y cómo viene cada paciente?' });
  else if (r.citas_proximos_7_dias === 0 && r.pacientes_activos > 0) out.push({ id: 'cn-vacia', nivel: 'aviso', icono: 'bi-calendar-x', texto: 'No hay citas en los próximos 7 días', ruta: '/staff/citas.html', pregunta: '¿Qué pacientes llevan más tiempo sin control?' });
  return out;
}
