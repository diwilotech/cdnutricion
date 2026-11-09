// Inicio = el módulo Dashboard de Diwilo Modulos (saludo con la marca, alertas, resúmenes de los módulos centrales, accesos directos).
// Aquí solo se registra lo PROPIO de Nutrición: el consultorio de hoy (indicadores, agenda, próximas citas), el tablero con gráficas
// y el embudo de citas (arrastrar cambia el estado), además de las descargas en CSV.
(() => {
  const App = window.Nut;   // ayudas de Nutrición; window.App es el común del Dashboard
  const ready = App.init('inicio');
  const { esc } = App;
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const kv = () => new Promise((ok) => { if (window.DwViz) return ok(); const j = document.createElement('script'); j.src = '/m/dwviz.js'; j.onload = j.onerror = () => ok(); document.head.appendChild(j); });

  // ---- números de la figura «Así funciona tu negocio» ----
  window.DwInicioValores = async () => {
    await ready;
    const d = await App.api('/dashboard');
    return { pacientes: App.fmtNum(d.kpis.active_patients, 0), citas: d.kpis.appts_today, consultas: d.kpis.consultations_month };
  };

  // ---- el consultorio hoy ----
  (window.DwDashboard = window.DwDashboard || []).push({
    id: 'consultorio',
    titulo: 'Tu consultorio',
    async mount(host) {
      await ready;
      host.innerHTML = '<div class="empty small">Cargando…</div>';
      const d = await App.api('/dashboard'), k = d.kpis, p = d.progress || {};
      const card = ([icon, label, value, sub]) => `<div class="col-6 col-lg-3"><div class="card kpi h-100"><div class="d-flex justify-content-between align-items-start"><div class="kpi-label">${label}</div><i class="bi ${icon} kpi-icon"></i></div><div class="kpi-value mt-1">${esc(value)}</div><div class="small text-body-secondary mt-1">${esc(sub)}</div></div></div>`;
      const empty = (m) => `<div class="empty small">${m}</div>`;
      const person = (x, right, href) => `<a class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-2" href="${href}" data-go="${href}"><span class="avatar">${esc(App.initials(x))}</span><span class="flex-grow-1 text-truncate">${esc(App.fullName(x))}</span>${right}</a>`;
      host.innerHTML = `
        <div class="row g-3 mb-3">${[
          ['bi-people', 'Pacientes activos', k.active_patients, `+${k.new_patients_month} este mes`],
          ['bi-calendar-check', 'Citas hoy', k.appts_today, `${k.appts_week} en los próximos 7 días`],
          ['bi-clipboard2-pulse', 'Consultas del mes', k.consultations_month, k.no_show_month ? `${k.no_show_month} inasistencias` : 'Sin inasistencias'],
          ['bi-graph-down-arrow', 'Peso perdido (total)', p.kg_total ? `${App.fmtNum(p.kg_total)} kg` : '—', p.tracked ? `${p.improving} de ${p.tracked} pacientes bajando` : 'Requiere 2+ consultas'],
        ].map(card).join('')}</div>
        <div class="row g-3">
          <div class="col-lg-7"><div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center py-3"><span><i class="bi bi-clock me-2"></i>Agenda de hoy</span><a href="/staff/citas.html" data-go="/staff/citas.html" class="small">Ver agenda</a></div>
            <div class="list-group list-group-flush">${d.todayAppointments.length ? d.todayAppointments.map((a) => `<a class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3" href="/staff/cuerpo.html?id=${esc(a.patient_id)}"><span class="appt-time">${App.fmtTime(a.starts_at)}</span><span class="avatar">${esc(App.initials(a))}</span><span class="flex-grow-1"><span class="d-block fw-medium">${esc(App.fullName(a))}</span><span class="small text-body-secondary">${App.KIND[a.kind]} · ${a.duration_min} min</span></span>${App.statusBadge(a.status)}</a>`).join('') : empty('<i class="bi bi-cup-hot d-block fs-3 mb-1"></i>No hay citas para hoy')}</div></div></div>
          <div class="col-lg-5 d-flex flex-column gap-3">
            <div class="card"><div class="card-header py-3"><i class="bi bi-calendar-week me-2"></i>Próximos 7 días</div><div class="list-group list-group-flush">${d.upcoming.length ? d.upcoming.map((a) => person(a, `<span class="small text-body-secondary text-nowrap">${App.fmtDate(a.starts_at, { weekday: true }).split(' ').slice(0, 3).join(' ')} · ${App.fmtTime(a.starts_at)}</span>`, `/staff/cuerpo.html?id=${esc(a.patient_id)}`)).join('') : empty('Sin citas programadas')}</div></div>
            <div class="card"><div class="card-header d-flex justify-content-between align-items-center py-3"><span><i class="bi bi-person-plus me-2"></i>Pacientes recientes</span><a href="/staff/pacientes.html" data-go="/staff/pacientes.html" class="small">Ver todos</a></div><div class="list-group list-group-flush">${d.recentPatients.length ? d.recentPatients.map((x) => person(x, `<span class="small text-body-secondary">${App.fmtDate(x.created_at)}</span>`, `/staff/cuerpo.html?id=${esc(x.id)}`)).join('') : empty('Aún no hay pacientes')}</div></div>
          </div></div>`;
    },
  });

  // ---- tablero con el kit común: crecimiento, asistencia, pacientes que no vuelven, avance y embudo de citas ----
  (window.DwDashboard = window.DwDashboard || []).push({
    id: 'tablero',
    titulo: 'Tablero del consultorio',
    async mount(host) {
      await Promise.all([ready, kv()]);
      const V = window.DwViz; if (!V) return;
      let t; try { t = await App.api('/tablero'); } catch { host.innerHTML = ''; return; }
      host.innerHTML = '<div class="dv-g"><div data-a></div><div data-b></div></div><div class="dv-g mt-3"><div data-c></div><div data-d></div></div><div class="mt-3" data-e></div><div class="card mt-3 p-3 d-flex flex-row flex-wrap gap-2 align-items-center"><b class="me-auto small text-uppercase text-body-secondary">Descargar</b><button class="btn btn-sm btn-outline-secondary" data-csv="pacientes"><i class="bi bi-download me-1"></i>Pacientes</button><button class="btn btn-sm btn-outline-secondary" data-csv="consultas"><i class="bi bi-download me-1"></i>Consultas</button><button class="btn btn-sm btn-outline-secondary" data-csv="citas"><i class="bi bi-download me-1"></i>Citas</button></div>';
      const box = (id, titulo, sub) => { const h = host.querySelector(`[data-${id}]`); h.innerHTML = V.tarjeta(titulo, '<div data-in></div>', { sub }); return h.querySelector('[data-in]'); };
      V.barras(box('a', 'Consultas y pacientes nuevos', 'Últimos 6 meses'), { etiquetas: t.meses.map((m) => MES[+m.mes.slice(5) - 1]), series: [{ nombre: 'Consultas', datos: t.meses.map((m) => m.consultas) }, { nombre: 'Pacientes nuevos', datos: t.meses.map((m) => m.nuevos), color: '#34D399' }] });
      const NOM = { done: 'Atendidas', scheduled: 'Programadas', cancelled: 'Canceladas', no_show: 'No asistió' };
      const dona = box('b', 'Citas de los últimos 30 días', t.asistencia == null ? 'Aún sin citas atendidas' : `Asistencia ${t.asistencia} %`);
      const lista = Object.entries(t.estados).map(([k, n]) => ({ nombre: NOM[k] || k, valor: n }));
      if (lista.length) V.dona(dona, lista, { centro: 'Citas' }); else V.vacio(dona, { icono: 'bi-calendar-check', titulo: 'Sin citas recientes', texto: 'Agenda citas y verás aquí cómo van.' });
      const sv = box('c', 'Llevan tiempo sin volver', 'Más de 60 días desde su última consulta');
      sv.innerHTML = t.sin_volver.length ? t.sin_volver.map((x) => `<a class="d-flex gap-2 py-2 border-bottom text-decoration-none text-reset" href="/staff/cuerpo.html?id=${esc(x.id)}"><span class="avatar">${esc(App.initials(x))}</span><span class="flex-grow-1 text-truncate"><b>${esc(App.fullName(x))}</b><span class="d-block small text-body-secondary">${x.ultima ? 'Última consulta ' + App.fmtDate(x.ultima) : 'Aún sin consulta'}</span></span>${x.phone ? `<span class="small text-body-secondary">${esc(x.phone)}</span>` : ''}</a>`).join('') : '<div class="small text-body-secondary p-2">Todos tus pacientes activos han vuelto en los últimos 60 días.</div>';
      const av = box('d', 'Quiénes más han avanzado', 'Kilos menos desde la primera consulta');
      if (t.avance.length) V.ranking(av, t.avance.map((x) => ({ nombre: App.fullName(x), valor: x.kg })), { fmt: (v) => `${App.fmtNum(v)} kg` }); else V.vacio(av, { icono: 'bi-graph-down-arrow', titulo: 'Todavía sin evolución', texto: 'Se calcula con 2 o más consultas con peso.' });
      const { items, today } = await App.api('/embudo');
      const COLS = [['scheduled', 'Programadas', '#60A5FA'], ['done', 'Atendidas', '#34D399'], ['no_show', 'No asistió', '#FBBF24'], ['cancelled', 'Canceladas', '#F87171']];
      const kb = box('e', 'Embudo de citas', 'De hace 7 días a 14 adelante · arrastra para cambiar el estado');
      const pintar = () => V.kanban(kb, {
        columnas: COLS.map(([id, titulo, color]) => ({ id, titulo, color, items: items.filter((a) => a.status === id).map((a) => ({ id: a.id, titulo: App.fullName(a), detalle: `${a.starts_at.slice(0, 10) === today ? 'hoy' : App.fmtDate(a.starts_at)} ${App.fmtTime(a.starts_at)} · ${App.KIND[a.kind] || a.kind}` })) })),
        mover: async (id, desde, hasta) => {
          try { await App.api(`/appointments/${id}/status`, { method: 'POST', body: { status: hasta } }); items.find((a) => a.id === id).status = hasta; App.toast('Cita actualizada'); pintar(); } catch (err) { App.fail(err); }
        } });
      pintar();
      host.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = async () => {
        const r = await fetch(`/api/admin/export/${b.dataset.csv}`, { credentials: 'same-origin' });
        if (!r.ok) { App.toast('No se pudo descargar', 'error'); return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${b.dataset.csv}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }));
    },
  });
})();
