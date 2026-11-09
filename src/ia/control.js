// Control por IA de los módulos de Nutrición: cada herramienta llama a la MISMA ruta de la API (src/api/*.js) con el contexto del token,
// así hereda permisos por rol y módulo, validaciones, solo lectura por suscripción vencida y bitácora (ver interno.js).
// Nombre: <modulo>.<verbo>_<objeto>. Herramienta nueva = una línea con herramienta({... ruta: [MÉTODO, '/api/…/:param']}).
import { herramienta } from './interno.js';

const T = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });
const ID = (d) => T(d);

export default [
  // ----- Pacientes -----
  herramienta({ name: 'pacientes.buscar_pacientes', modulo: 'pacientes', tipo: 'lectura', description: 'Busca pacientes por nombre, documento o celular (activos por defecto).',
    props: { q: T('Texto a buscar'), status: T('active o archived') }, ruta: ['GET', '/api/admin/patients'] }),
  herramienta({ name: 'pacientes.ver_paciente', modulo: 'pacientes', tipo: 'lectura', description: 'Ficha de un paciente: datos, consultas con peso/grasa/músculo y citas.',
    props: { id: ID('Id del paciente') }, required: ['id'], ruta: ['GET', '/api/admin/patients/:id'] }),
  herramienta({ name: 'pacientes.ver_cuerpo_vivo', modulo: 'pacientes', tipo: 'lectura', description: 'Seguimiento completo (Cuerpo Vivo) de un paciente: perfil, laboratorios, recomendaciones, registro diario y planes.',
    props: { id: ID('Id del paciente') }, required: ['id'], ruta: ['GET', '/api/admin/patients/:id/cuerpo'] }),
  herramienta({ name: 'pacientes.crear_paciente', modulo: 'pacientes', tipo: 'escritura', description: 'Registra un paciente nuevo.',
    props: { first_name: T('Nombre'), last_name: T('Apellido'), doc_id: T('Documento'), sex: T('F o M'), birth_date: T('Nacimiento AAAA-MM-DD'), phone: T('Celular'), email: T('Correo'), height_cm: N('Estatura en cm'), goal: T('Objetivo'), notes: T('Notas') },
    required: ['first_name'], ruta: ['POST', '/api/admin/patients'] }),
  herramienta({ name: 'pacientes.editar_paciente', modulo: 'pacientes', tipo: 'escritura', description: 'Edita los datos de un paciente (envía todos los campos que quieras conservar).',
    props: { id: ID('Id del paciente'), first_name: T('Nombre'), last_name: T('Apellido'), doc_id: T('Documento'), sex: T('F o M'), birth_date: T('Nacimiento AAAA-MM-DD'), phone: T('Celular'), email: T('Correo'), height_cm: N('Estatura en cm'), goal: T('Objetivo'), notes: T('Notas'), status: T('active o archived') },
    required: ['id', 'first_name'], ruta: ['PUT', '/api/admin/patients/:id'] }),
  herramienta({ name: 'pacientes.registrar_consulta', modulo: 'pacientes', tipo: 'escritura', description: 'Registra una consulta de un paciente con su peso y composición corporal.',
    props: { id: ID('Id del paciente'), date: T('Fecha AAAA-MM-DD'), weight_kg: N('Peso en kg'), fat_pct: N('% de grasa'), muscle_pct: N('% de músculo'), height_cm: N('Estatura en cm'), notes: T('Notas de la consulta') },
    required: ['id', 'date'], ruta: ['POST', '/api/admin/patients/:id/consultations'] }),

  // ----- Agenda -----
  herramienta({ name: 'citas.listar_citas', modulo: 'citas', tipo: 'lectura', description: 'Lista las citas de un rango de fechas (por defecto, los próximos 7 días).',
    props: { from: T('Desde AAAA-MM-DD'), to: T('Hasta AAAA-MM-DD') }, ruta: ['GET', '/api/admin/appointments'] }),
  herramienta({ name: 'citas.crear_cita', modulo: 'citas', tipo: 'escritura', description: 'Agenda una cita para un paciente.',
    props: { patient_id: ID('Id del paciente'), starts_at: T('Fecha y hora AAAA-MM-DDTHH:MM (hora del consultorio)'), duration_min: N('Duración en minutos'), kind: T('primera, control o virtual'), notes: T('Notas') },
    required: ['patient_id', 'starts_at'], ruta: ['POST', '/api/admin/appointments'] }),
  herramienta({ name: 'citas.cambiar_estado', modulo: 'citas', tipo: 'escritura', description: 'Marca una cita como atendida (done), cancelada (cancelled), no asistió (no_show) o programada (scheduled).',
    props: { id: ID('Id de la cita'), status: T('scheduled, done, cancelled o no_show') }, required: ['id', 'status'], ruta: ['POST', '/api/admin/appointments/:id/status'] }),

  // ----- Tablero -----
  herramienta({ name: 'pacientes.tablero', modulo: 'pacientes', tipo: 'lectura', description: 'Tablero del consultorio: consultas y pacientes nuevos por mes, asistencia, pacientes que llevan más de 60 días sin volver y quiénes más han avanzado.',
    ruta: ['GET', '/api/admin/tablero'] }),
];
