// Utilidades compartidas del panel. Cada página llama App.init('<seccion>').
'use strict';

const App = (() => {
  const API = '/api/admin';
  let me = null;

  // Tema claro/oscuro según el sistema.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => document.documentElement.setAttribute('data-bs-theme', media.matches ? 'dark' : 'light');
  applyTheme();
  media.addEventListener('change', applyTheme);

  // ---------- formato ----------

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  function fmtDate(iso, { weekday = false } = {}) {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    const wd = weekday ? DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' : '';
    return `${wd}${d} ${MESES[m - 1]} ${y}`;
  }
  const fmtTime = (iso) => (iso && iso.length >= 16 ? iso.slice(11, 16) : '');
  const fmtDateTime = (iso) => (iso ? `${fmtDate(iso, { weekday: true })} · ${fmtTime(iso)}` : '—');
  const fmtNum = (n, digits = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: digits }));
  const fullName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim();
  const initials = (p) => ((p.first_name || '?')[0] + ((p.last_name || '')[0] || '')).toUpperCase();

  function age(birth) {
    if (!birth) return null;
    const b = new Date(birth + 'T00:00:00');
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }

  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const STATUS = {
    scheduled: ['Programada', 'primary'],
    done: ['Atendida', 'success'],
    cancelled: ['Cancelada', 'secondary'],
    no_show: ['No asistió', 'danger'],
  };
  const KIND = { primera: 'Primera vez', control: 'Control', virtual: 'Virtual' };
  const ROLE = { owner: 'Propietario', admin: 'Administrador', staff: 'Equipo' };
  const statusBadge = (s) => {
    const [txt, cls] = STATUS[s] || [s, 'secondary'];
    return `<span class="badge text-bg-${cls} bg-opacity-75">${txt}</span>`;
  };

  // ---------- API ----------

  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = { 'x-cdn': '1' };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(API + path, { method, headers, body: payload, credentials: 'same-origin' });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) {
      if (data?.code === 'NO_SESSION' && !location.pathname.startsWith('/admin/login')) {
        location.href = '/admin/login?next=' + encodeURIComponent(location.pathname + location.search);
        return new Promise(() => {});
      }
      const err = new Error(data?.error || `Error ${res.status}`);
      err.status = res.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }

  // ---------- UI ----------

  function toast(message, type = 'success') {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type === 'error' ? 'danger' : type} border-0`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button></div>`;
    box.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: type === 'error' ? 6000 : 3000 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    t.show();
  }

  const fail = (err) => toast(err.message || String(err), 'error');

  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value.trim();
    }
    return out;
  }

  function fillForm(form, data) {
    for (const el of form.elements) {
      if (!el.name || !(el.name in data)) continue;
      if (el.type === 'checkbox') el.checked = !!data[el.name];
      else el.value = data[el.name] ?? '';
    }
  }

  // Envuelve un submit: deshabilita el botón mientras corre y muestra errores.
  function onSubmit(form, handler) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }
      const btn = form.querySelector('[type=submit]') || document.querySelector(`[form="${form.id}"][type=submit]`);
      if (btn) btn.disabled = true;
      try {
        await handler(formData(form), ev);
        form.classList.remove('was-validated');
      } catch (err) {
        fail(err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  async function confirmAction(message) {
    return window.confirm(message);
  }

  const param = (name) => new URLSearchParams(location.search).get(name);

  // ---------- encabezado / navegación ----------

  const NAV = [
    ['inicio', '/admin/', 'bi-house', 'Inicio'],
    ['pacientes', '/admin/pacientes', 'bi-people', 'Pacientes'],
    ['citas', '/admin/citas', 'bi-calendar-week', 'Agenda'],
    ['ajustes', '/admin/ajustes', 'bi-gear', 'Ajustes'],
  ];

  function renderNav(active, { bottomNav = true } = {}) {
    const s = me.session || {};
    const items = s.businessId ? NAV : [];
    const links = items.map(
      ([key, href, icon, label]) =>
        `<li class="nav-item"><a class="nav-link ${key === active ? 'active' : ''}" href="${href}"><i class="bi ${icon} me-1"></i>${label}</a></li>`,
    ).join('');
    const switcher =
      me.businesses.length > 1
        ? `<li><h6 class="dropdown-header">Cambiar de negocio</h6></li>` +
          me.businesses
            .map(
              (b) => `<li><button class="dropdown-item d-flex justify-content-between gap-3" data-business="${esc(b.id)}">
                <span>${esc(b.name)}</span>${b.id === s.businessId ? '<i class="bi bi-check2"></i>' : ''}</button></li>`,
            )
            .join('') +
          '<li><hr class="dropdown-divider"></li>'
        : '';
    // Sin barra inferior (p. ej. Cuerpo Vivo usa la suya), las secciones van en el menú en celular.
    const mobileLinks = !bottomNav && items.length
      ? items.map(([, href, icon, label]) => `<li class="d-lg-none"><a class="dropdown-item" href="${href}"><i class="bi ${icon} me-2"></i>${label}</a></li>`).join('') +
        '<li class="d-lg-none"><hr class="dropdown-divider"></li>'
      : '';

    const nav = document.createElement('nav');
    nav.className = 'navbar navbar-expand navbar-cdn sticky-top';
    nav.innerHTML = `
      <div class="container-xl">
        <a class="navbar-brand" href="/admin/"><span class="brand-logo"><i class="bi bi-person-arms-up"></i></span><span class="d-none d-sm-inline">CD Nutrición</span></a>
        <ul class="navbar-nav me-auto d-none d-lg-flex gap-1">${links}</ul>
        <ul class="navbar-nav ms-auto">
          <li class="nav-item dropdown">
            <a class="nav-link dropdown-toggle d-flex align-items-center gap-2" href="#" data-bs-toggle="dropdown" aria-expanded="false">
              <span class="avatar" style="width:1.9rem;height:1.9rem;font-size:.75rem">${esc(((me.name || me.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('')).toUpperCase())}</span>
              <span class="text-truncate" style="max-width:12rem">${esc(s.businessName || 'Sin negocio')}</span>
            </a>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
              ${mobileLinks}
              ${switcher}
              <li><span class="dropdown-item-text small text-body-secondary">${esc(me.name || '')}<br>${esc(me.email)} · ${esc(ROLE[s.role] || '')}</span></li>
              <li><button class="dropdown-item" data-action="change-password"><i class="bi bi-key me-2"></i>Cambiar contraseña</button></li>
              <li><button class="dropdown-item" data-action="logout"><i class="bi bi-box-arrow-right me-2"></i>Salir</button></li>
            </ul>
          </li>
        </ul>
      </div>`;
    document.body.prepend(nav);
    document.querySelector('main')?.classList.add('cdn-enter');

    if (bottomNav && items.length) {
      const bar = document.createElement('nav');
      bar.className = 'bottom-nav';
      bar.setAttribute('aria-label', 'Secciones');
      bar.innerHTML = items.map(([key, href, icon, label]) =>
        `<a href="${href}" class="${key === active ? 'active' : ''}" ${key === active ? 'aria-current="page"' : ''}><i class="bi ${icon}${key === active ? '-fill' : ''}"></i><span>${label}</span></a>`).join('');
      document.body.appendChild(bar);
      document.body.classList.add('has-bottom-nav');
    }
    if (s.readOnly) {
      const bar = document.createElement('div');
      bar.className = 'alert alert-danger rounded-0 border-0 text-center small fw-semibold py-2 mb-0';
      bar.innerHTML = '<i class="bi bi-lock-fill me-1"></i>La suscripción del consultorio está vencida: puedes consultar, pero no guardar cambios.';
      nav.after(bar);
    }

    nav.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-business]');
      if (b) {
        try {
          await api('/auth/business', { method: 'POST', body: { businessId: b.dataset.business } });
          location.href = '/admin/';
        } catch (err) { fail(err); }
        return;
      }
      const a = ev.target.closest('[data-action]');
      if (a?.dataset.action === 'logout') {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        location.href = '/admin/login';
      } else if (a?.dataset.action === 'change-password') {
        changePasswordDialog();
      }
    });
  }

  function modal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'modal fade';
    wrap.tabIndex = -1;
    wrap.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content">${html}</div></div>`;
    document.body.appendChild(wrap);
    const m = new bootstrap.Modal(wrap);
    wrap.addEventListener('hidden.bs.modal', () => wrap.remove());
    m.show();
    return { el: wrap, hide: () => m.hide() };
  }

  function changePasswordDialog() {
    const { el, hide } = modal(`
      <form id="passwordForm" novalidate>
        <div class="modal-header"><h5 class="modal-title">Cambiar contraseña</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
        <div class="modal-body">
          <input type="email" class="d-none" value="${esc(me.email)}" autocomplete="username">
          <label class="form-label">Contraseña actual</label>
          <input name="currentPassword" type="password" class="form-control mb-3" required autocomplete="current-password">
          <label class="form-label">Contraseña nueva (mínimo 8 caracteres)</label>
          <input name="newPassword" type="password" minlength="8" class="form-control" required autocomplete="new-password">
        </div>
        <div class="modal-footer"><button type="submit" class="btn btn-primary">Guardar</button></div>
      </form>`);
    onSubmit(el.querySelector('form'), async (d) => {
      await api('/auth/change-password', { method: 'POST', body: d });
      hide();
      toast('Contraseña actualizada');
    });
  }

  // Muestra un link de invitación para copiarlo y enviarlo.
  function inviteDialog(url, title = 'Link de acceso') {
    const { el } = modal(`
      <div class="modal-header"><h5 class="modal-title">${esc(title)}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
      <div class="modal-body">
        <p class="small text-body-secondary">Envíale este link a la persona. Al abrirlo crea su contraseña y entra. Sirve una sola vez.</p>
        <div class="input-group"><input class="form-control" readonly value="${esc(url)}">
          <button class="btn btn-outline-primary" type="button" data-copy><i class="bi bi-copy"></i></button></div>
      </div>`);
    el.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { el.querySelector('input').select(); }
    });
  }

  function businessPicker() {
    const main = document.querySelector('main');
    const list = me.businesses
      .filter((b) => b.status === 'active')
      .map(
        (b) => `<button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-business="${esc(b.id)}">
          <span><i class="bi bi-shop me-2"></i>${esc(b.name)}</span><span class="badge text-bg-light">${esc(ROLE[b.role] || '')}</span></button>`,
      )
      .join('');
    main.innerHTML = `
      <div class="card mx-auto mt-4" style="max-width:32rem"><div class="card-body p-4">
        <h1 class="h5 mb-3">Elige un negocio</h1>
        ${list ? `<div class="list-group">${list}</div>` : '<p class="text-body-secondary mb-0">Tu correo no está asociado a ningún consultorio activo.</p>'}
      </div></div>`;
    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-business]');
      if (!b) return;
      try {
        await api('/auth/business', { method: 'POST', body: { businessId: b.dataset.business } });
        location.reload();
      } catch (err) { fail(err); }
    });
  }

  // Devuelve la info del usuario o null si la página no debe continuar (falta negocio).
  async function init(active, { needsBusiness = true, bottomNav = true } = {}) {
    me = await api('/auth/me');
    if (!me.session) {
      location.href = '/admin/login?next=' + encodeURIComponent(location.pathname + location.search);
      return null;
    }
    renderNav(active, { bottomNav });
    if (needsBusiness && !me.session.businessId) {
      businessPicker();
      return null;
    }
    return me;
  }

  return {
    api, init, toast, fail, esc, modal, inviteDialog, onSubmit, formData, fillForm, confirmAction, param,
    fmtDate, fmtTime, fmtDateTime, fmtNum, fullName, initials, age, todayLocal, addDays,
    statusBadge, STATUS, KIND, ROLE,
    get me() { return me; },
  };
})();
