// Editor "sobre la tarjeta": la misma tarjeta de contacto pública, con cada dato editable en su lugar.
// CardEditor.mount(el, { kind: 'business' | 'member', data, fallback, onPhoto, onPhotoRemove }) -> { read() }
//   data:     { name, org, phone, email, logo, card }      (member: name = nombre en la tarjeta)
//   fallback: { phone, card } del negocio (member): lo que el miembro deja vacío se toma de ahí.
'use strict';

const CardEditor = (() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const PRESETS = [['Instagram', 'https://instagram.com/'], ['Facebook', 'https://facebook.com/'], ['TikTok', 'https://tiktok.com/@'],
    ['YouTube', 'https://youtube.com/@'], ['LinkedIn', 'https://linkedin.com/in/'], ['Sitio web', 'https://']];
  let uid = 0;

  function mount(el, { kind, data, fallback = {}, onPhoto, onPhotoRemove }) {
    const member = kind === 'member';
    const c = data.card || {}, fb = fallback.card || {};
    const id = `ce${++uid}`;
    const from = (v, label) => (v ? `Del negocio: ${v}` : label);
    let photo = data.logo || null;

    el.innerHTML = `
      <div class="vc vc-edit">
        <section class="vc-hero">
          <div class="vc-avatar vc-avatar-edit" data-e="avatar" role="button" tabindex="0" title="Cambiar foto"></div>
          <input type="file" accept="image/*" hidden data-e="file">
          <div><button type="button" class="vc-photo-del" data-e="photoDel" hidden>Quitar foto</button></div>
          <input class="vc-in vc-in-name" data-e="name" maxlength="${member ? 80 : 120}" placeholder="${member ? 'Tu nombre' : 'Nombre del negocio'}" value="${esc(data.name)}">
          ${member && data.org ? `<div class="vc-org"><i class="bi bi-hospital me-1"></i>${esc(data.org)}</div>` : ''}
          <input class="vc-in vc-in-spec" data-e="specialty" maxlength="80" placeholder="${member ? 'Especialidad' : 'Ej. Centro de nutrición'}" value="${esc(c.specialty)}">
          <textarea class="vc-in vc-in-bio" data-e="bio" maxlength="500" rows="3" placeholder="${member ? 'Cuéntales a tus pacientes cómo los acompañas…' : 'Cuéntales quiénes son…'}">${esc(c.bio)}</textarea>
        </section>

        <div class="vc-panel">
          <div class="vc-row"><i class="bi bi-whatsapp"></i><input class="vc-in2" data-e="phone" type="tel" maxlength="30"
            placeholder="${member ? esc(from(fallback.phone, 'WhatsApp')) : 'WhatsApp del negocio'}" value="${esc(member ? c.phone : data.phone)}"></div>
          <div class="vc-row"><i class="bi bi-envelope"></i><input class="vc-in2" data-e="email" type="email" maxlength="254"
            placeholder="${member ? 'Correo público (opcional)' : 'Correo del negocio'}" value="${esc(member ? c.email : data.email)}"></div>
        </div>

        <div class="vc-panel">
          <div class="vc-row"><i class="bi bi-geo-alt-fill"></i><input class="vc-in2" data-e="address" maxlength="200"
            placeholder="${member ? esc(from(fb.address, 'Dirección donde atiendes')) : 'Dirección del negocio'}" value="${esc(c.address)}"></div>
          <div class="vc-row"><i class="bi bi-map"></i>
            <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="${id}map" data-e="showMap" ${c.showMap ? 'checked' : ''}>
              <label class="form-check-label small" for="${id}map">Mostrar mapa${member && fb.showMap ? ' propio (si no, el del negocio)' : ''}</label></div></div>
          <div data-e="mapBox" hidden>
            <div class="d-flex gap-2 flex-wrap mt-2">
              <button type="button" class="btn btn-sm btn-outline-primary" data-e="locate"><i class="bi bi-crosshair me-1"></i>Usar mi ubicación</button>
            </div>
            <input class="form-control form-control-sm mt-2" data-e="mapsLink" placeholder="…o pega el enlace de Google Maps">
            <div class="row g-2 mt-0">
              <div class="col-6"><input class="form-control form-control-sm" data-e="lat" inputmode="decimal" placeholder="Latitud" value="${esc(c.lat ?? '')}"></div>
              <div class="col-6"><input class="form-control form-control-sm" data-e="lng" inputmode="decimal" placeholder="Longitud" value="${esc(c.lng ?? '')}"></div>
            </div>
            <div class="vc-map" data-e="mapWrap" hidden><iframe loading="lazy" title="Mapa" data-e="map"></iframe></div>
          </div>
          <div class="vc-row"><i class="bi bi-clock-fill"></i><input class="vc-in2" data-e="hours" maxlength="120"
            placeholder="${member ? esc(from(fb.hours, 'Horario de atención')) : 'Ej. Lun a Vie · 7:00 a. m. – 6:00 p. m.'}" value="${esc(c.hours)}"></div>
        </div>

        <div class="vc-panel">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-semibold small">Redes y enlaces</span>
            ${member && (fb.links || []).length ? '<span class="small text-body-secondary">Vacío = los del negocio</span>' : ''}
          </div>
          <div data-e="links" class="d-flex flex-column gap-2"></div>
          <div class="d-flex flex-wrap gap-1 mt-2" data-e="presets">
            ${PRESETS.map(([n, u]) => `<button type="button" class="btn btn-sm btn-light py-0 px-2" data-preset="${n}|${u}"><i class="bi ${CardView.linkIcon(u + 'x')} me-1"></i>${n}</button>`).join('')}
            <button type="button" class="btn btn-sm btn-light py-0 px-2" data-preset="|"><i class="bi bi-plus-lg me-1"></i>Otro</button>
          </div>
        </div>
      </div>`;

    const q = (k) => el.querySelector(`[data-e="${k}"]`);
    const linkRow = (l = {}) => `<div class="vc-link-edit" data-link>
        <i class="bi ${CardView.linkIcon(l.url || '')}"></i>
        <input class="vc-in2" data-l="label" maxlength="40" placeholder="Nombre" value="${esc(l.label)}">
        <input class="vc-in2" data-l="url" maxlength="300" placeholder="https://…" value="${esc(l.url)}">
        <button type="button" class="btn btn-sm btn-link text-danger p-0" data-unlink aria-label="Quitar enlace"><i class="bi bi-x-lg"></i></button>
      </div>`;
    q('links').innerHTML = (c.links || []).map(linkRow).join('');

    function paintAvatar() {
      const initials = String(q('name').value || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      q('avatar').innerHTML = (photo ? `<img src="${esc(photo)}" alt="">` : member ? `<span class="vc-initials">${esc(initials)}</span>` : '<i class="bi bi-person-arms-up"></i>')
        + '<span class="vc-cam"><i class="bi bi-camera-fill"></i></span>';
      q('photoDel').hidden = !photo;
    }
    let mapTimer;
    function paintMap() {
      q('mapBox').hidden = !q('showMap').checked;
      clearTimeout(mapTimer);
      mapTimer = setTimeout(() => {
        const lat = parseFloat(q('lat').value), lng = parseFloat(q('lng').value), ok = Number.isFinite(lat) && Number.isFinite(lng);
        q('mapWrap').hidden = !ok;
        const src = ok ? `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed` : '';
        if (ok && q('map').getAttribute('src') !== src) q('map').setAttribute('src', src);
      }, 400);
    }
    paintAvatar(); paintMap();

    // Foto: se recorta en cuadrado de 512 px en el navegador antes de subirla.
    const pick = () => q('file').click();
    q('avatar').onclick = pick;
    q('avatar').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    q('file').onchange = async (ev) => {
      const file = ev.target.files[0]; ev.target.value = '';
      if (!file) return;
      try { photo = await onPhoto(await squarePng(file)); paintAvatar(); } catch (err) { App.fail(err); }
    };
    q('photoDel').onclick = async () => {
      if (!confirm('¿Quitar la foto?')) return;
      try { await onPhotoRemove(); photo = null; paintAvatar(); } catch (err) { App.fail(err); }
    };
    q('name').addEventListener('input', paintAvatar);
    q('showMap').addEventListener('change', paintMap);
    q('lat').addEventListener('input', paintMap);
    q('lng').addEventListener('input', paintMap);
    q('mapsLink').addEventListener('input', (ev) => {
      const v = decodeURIComponent(ev.target.value);
      const m = v.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || v.match(/[?&](?:q|query|ll|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (!m) { if (v.trim()) App.toast(/goo\.gl|maps\.app/.test(v) ? 'Ese es un enlace corto: ábrelo y copia el enlace largo de la barra del navegador' : 'No encontramos coordenadas en ese enlace', 'warning'); return; }
      q('lat').value = m[1]; q('lng').value = m[2]; paintMap(); App.toast('Ubicación tomada del enlace');
    });
    q('locate').onclick = () => {
      if (!navigator.geolocation) return App.toast('Tu navegador no permite ubicación', 'error');
      q('locate').disabled = true;
      navigator.geolocation.getCurrentPosition((p) => {
        q('lat').value = p.coords.latitude.toFixed(6); q('lng').value = p.coords.longitude.toFixed(6);
        q('locate').disabled = false; paintMap(); App.toast('Ubicación actual tomada');
      }, () => { q('locate').disabled = false; App.toast('No pudimos obtener tu ubicación', 'error'); }, { enableHighAccuracy: true, timeout: 10000 });
    };
    q('presets').onclick = (ev) => {
      const b = ev.target.closest('[data-preset]'); if (!b) return;
      if (el.querySelectorAll('[data-link]').length >= 8) return App.toast('Máximo 8 enlaces', 'warning');
      const [label, url] = b.dataset.preset.split('|');
      q('links').insertAdjacentHTML('beforeend', linkRow({ label, url }));
      const row = q('links').lastElementChild, input = row.querySelector(label ? '[data-l=url]' : '[data-l=label]');
      input.focus(); if (label) input.setSelectionRange(url.length, url.length);
    };
    q('links').addEventListener('click', (ev) => { if (ev.target.closest('[data-unlink]')) ev.target.closest('[data-link]').remove(); });
    q('links').addEventListener('input', (ev) => {
      const row = ev.target.closest('[data-link]');
      if (row) row.querySelector('i').className = `bi ${CardView.linkIcon(row.querySelector('[data-l=url]').value)}`;
    });

    function read() {
      const v = (k) => q(k).value.trim();
      const lat = v('lat'), lng = v('lng');
      const card = {
        specialty: v('specialty'), bio: q('bio').value.trim(), address: v('address'), hours: v('hours'), showMap: q('showMap').checked,
        lat: lat === '' ? null : lat, lng: lng === '' ? null : lng,
        links: [...el.querySelectorAll('[data-link]')].map((r) => ({ label: r.querySelector('[data-l=label]').value.trim(), url: r.querySelector('[data-l=url]').value.trim() }))
          .filter((l) => l.label || l.url),
      };
      if (member) return { card: { ...card, displayName: v('name'), phone: v('phone'), email: v('email') } };
      return { name: v('name'), phone: v('phone'), email: v('email'), card };
    }
    return { read };
  }

  function squarePng(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height), canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
        URL.revokeObjectURL(img.src);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/png');
      };
      img.onerror = () => reject(new Error('Ese archivo no es una imagen válida'));
      img.src = URL.createObjectURL(file);
    });
  }

  return { mount, squarePng };
})();
