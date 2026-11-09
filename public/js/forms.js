// Diálogos de paciente y cita, compartidos entre páginas.
'use strict';

const Forms = (() => {
  const { esc } = App;

  // Abre el formulario de paciente. patient = null para crear. onSaved(id) al guardar.
  function patientDialog(patient, onSaved) {
    const editing = !!patient;
    const { el, hide } = App.modal(`
      <form novalidate>
        <div class="modal-header">
          <h5 class="modal-title">${editing ? 'Editar paciente' : 'Nuevo paciente'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body">
          <div class="row g-3">
            <div class="col-sm-6"><label class="form-label">Nombre *</label><input name="first_name" class="form-control" required maxlength="80"></div>
            <div class="col-sm-6"><label class="form-label">Apellido</label><input name="last_name" class="form-control" maxlength="80"></div>
            <div class="col-sm-6"><label class="form-label">Documento</label><input name="doc_id" class="form-control" maxlength="30"></div>
            <div class="col-sm-6"><label class="form-label">Sexo</label>
              <select name="sex" class="form-select"><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select></div>
            <div class="col-sm-6"><label class="form-label">Fecha de nacimiento</label><input name="birth_date" type="date" class="form-control"></div>
            <div class="col-sm-6"><label class="form-label">Estatura (cm)</label><input name="height_cm" type="number" step="0.5" min="40" max="250" class="form-control"></div>
            <div class="col-sm-6"><label class="form-label">WhatsApp / teléfono</label><input name="phone" type="tel" class="form-control" maxlength="30" placeholder="300 123 4567"></div>
            <div class="col-sm-6"><label class="form-label">Correo</label><input name="email" type="email" class="form-control" maxlength="254"></div>
            <div class="col-12"><label class="form-label">Objetivo</label><input name="goal" class="form-control" maxlength="300" placeholder="Bajar grasa, ganar músculo…"></div>
            <div class="col-12"><label class="form-label">Notas internas</label><textarea name="notes" class="form-control" rows="3" maxlength="4000"></textarea></div>
            ${editing ? `<div class="col-12"><div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="archivedSwitch" name="archived">
              <label class="form-check-label" for="archivedSwitch">Paciente archivado</label></div></div>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-link text-body-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`);
    const form = el.querySelector('form');
    if (editing) App.fillForm(form, { ...patient, archived: patient.status === 'archived' });
    App.onSubmit(form, async (d) => {
      const body = { ...d, status: d.archived ? 'archived' : 'active' };
      delete body.archived;
      let id = patient?.id;
      if (editing) await App.api(`/patients/${id}`, { method: 'PUT', body });
      else id = (await App.api('/patients', { method: 'POST', body })).id;
      hide();
      App.toast(editing ? 'Paciente actualizado' : 'Paciente creado');
      onSaved?.(id);
    });
    el.addEventListener('shown.bs.modal', () => form.elements.first_name.focus());
  }

  // Formulario de cita. appt = null para crear; defaults = { patient_id, starts_at }.
  async function appointmentDialog(appt, onSaved, defaults = {}) {
    const editing = !!appt;
    const patients = (await App.api('/patients?page=1&q=')).items;
    let all = patients;
    // Si hay más de una página, se usa búsqueda en el selector.
    const options = (list, selected) =>
      list.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(App.fullName(p))}</option>`).join('');

    const v = appt || { duration_min: 45, kind: 'control', status: 'scheduled', ...defaults };
    const { el, hide } = App.modal(`
      <form novalidate>
        <div class="modal-header">
          <h5 class="modal-title">${editing ? 'Editar cita' : 'Agendar cita'}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
        </div>
        <div class="modal-body">
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label">Paciente *</label>
              <input type="search" class="form-control form-control-sm mb-1" placeholder="Buscar paciente…" data-role="search">
              <select name="patient_id" class="form-select" required>
                <option value="">Selecciona…</option>${options(all, v.patient_id)}
              </select>
            </div>
            <div class="col-sm-7"><label class="form-label">Fecha y hora *</label><input name="starts_at" type="datetime-local" class="form-control" required step="300"></div>
            <div class="col-sm-5"><label class="form-label">Duración (min)</label><input name="duration_min" type="number" min="5" max="480" step="5" class="form-control"></div>
            <div class="col-sm-6"><label class="form-label">Tipo</label>
              <select name="kind" class="form-select">${Object.entries(App.KIND).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
            <div class="col-sm-6"><label class="form-label">Estado</label>
              <select name="status" class="form-select">${Object.entries(App.STATUS).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
            <div class="col-12"><label class="form-label">Notas</label><textarea name="notes" class="form-control" rows="2" maxlength="1000"></textarea></div>
          </div>
        </div>
        <div class="modal-footer">
          ${editing ? '<button type="button" class="btn btn-outline-danger me-auto" data-role="delete"><i class="bi bi-trash"></i></button>' : ''}
          <button type="button" class="btn btn-link text-body-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>`);
    const form = el.querySelector('form');
    App.fillForm(form, { ...v, patient_id: v.patient_id || '' });

    // Asegura que el paciente preseleccionado aparezca aunque no esté en la primera página.
    const select = form.elements.patient_id;
    if (v.patient_id && ![...select.options].some((o) => o.value === v.patient_id) && v.first_name) {
      select.insertAdjacentHTML('beforeend', options([v], v.patient_id));
    }

    let timer;
    el.querySelector('[data-role=search]').addEventListener('input', (ev) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const current = select.value;
        all = (await App.api(`/patients?q=${encodeURIComponent(ev.target.value)}`)).items;
        select.innerHTML = '<option value="">Selecciona…</option>' + options(all, current);
        if (all.length === 1) select.value = all[0].id;
      }, 250);
    });

    el.querySelector('[data-role=delete]')?.addEventListener('click', async () => {
      if (!(await App.confirmAction('¿Eliminar esta cita?'))) return;
      try {
        await App.api(`/appointments/${appt.id}`, { method: 'DELETE' });
        hide();
        App.toast('Cita eliminada');
        onSaved?.();
      } catch (err) { App.fail(err); }
    });

    App.onSubmit(form, async (d) => {
      if (editing) await App.api(`/appointments/${appt.id}`, { method: 'PUT', body: d });
      else await App.api('/appointments', { method: 'POST', body: d });
      hide();
      App.toast(editing ? 'Cita actualizada' : 'Cita agendada');
      onSaved?.();
    });
  }

  return { patientDialog, appointmentDialog };
})();
