// Utilidades compartidas del panel. Cada página llama App.init('<seccion>').
'use strict';

// Ayudas de las páginas de Nutrición (pacientes, agenda, ficha). El panel común carga el menú; aquí solo van los datos.
const Nut = (() => {
  const API = '/api/admin';
  // El panel común (shell) ya resolvió el negocio: SLUG viene de /api/me.
  let SLUG = null;
  let me = null;

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
      if (data?.code === 'NO_SESSION') {
        (window.top || window).location.replace('/');
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

  // Devuelve la info del usuario (el panel común ya pintó el menú y comprobó la sesión).
  async function init(active) {
    const dw = await window.DW.ready;
    SLUG = dw.business.slug;
    me = {
      userId: dw.user.id, email: dw.user.email, name: dw.user.name,
      session: { businessId: dw.business.id, businessName: dw.business.name, businessSlug: dw.business.slug, role: dw.role, readOnly: dw.business.readOnly, paidUntil: dw.business.paidUntil },
      businesses: dw.businesses || [],
    };
    return me;
  }

  return {
    api, init, toast, get slug() { return SLUG; }, fail, esc, modal, inviteDialog, onSubmit, formData, fillForm, confirmAction, param,
    fmtDate, fmtTime, fmtDateTime, fmtNum, fullName, initials, age, todayLocal, addDays,
    statusBadge, STATUS, KIND, ROLE,
    get me() { return me; },
  };
})();
window.Nut = Nut;
// Las páginas de los módulos de Nutrición usan App.*. El Inicio (y las páginas de los módulos centrales, que usan el App común) lo conservan.
if (!window.DW_KEEP_APP) window.App = Nut;
