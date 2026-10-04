// Tarjeta digital del consultorio. La usan la página pública (/<slug>) y la vista previa de Ajustes,
// así ambas se ven exactamente igual. CardView.render(el, data, { preview, slug }).
'use strict';

const CardView = (() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Ícono según el sitio del enlace.
  function linkIcon(url) {
    const h = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const map = [
      [/instagram\./, 'bi-instagram'], [/facebook\.|fb\./, 'bi-facebook'], [/tiktok\./, 'bi-tiktok'], [/youtube\.|youtu\.be/, 'bi-youtube'],
      [/(^|\.)x\.com|twitter\./, 'bi-twitter-x'], [/linkedin\./, 'bi-linkedin'], [/wa\.me|whatsapp\./, 'bi-whatsapp'],
      [/maps\.|goo\.gl/, 'bi-geo-alt'], [/t\.me|telegram\./, 'bi-telegram'], [/calendly\.|cal\.com/, 'bi-calendar-check'],
    ];
    return (map.find(([re]) => re.test(h)) || [null, 'bi-globe2'])[1];
  }

  function haversineKm(a, b, c, d) {
    const R = 6371, toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(c - a), dLng = toR(d - b);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const waNumber = (phone) => {
    const d = String(phone || '').replace(/\D/g, '');
    return d.length === 10 ? '57' + d : d;
  };

  function render(el, d, { preview = false, slug = d.slug } = {}) {
    const c = d.card || {};
    const phone = waNumber(d.phone);
    const hasMap = c.showMap && c.lat != null && c.lng != null;
    const pageUrl = `${location.origin}/${slug}`;
    el.innerHTML = `
      <div class="vc">
        <section class="vc-hero">
          <div class="vc-avatar">${d.logo ? `<img src="${esc(d.logo)}" alt="">` : '<i class="bi bi-person-arms-up"></i>'}</div>
          <h1 class="vc-name">${esc(d.name || 'Tu consultorio')}</h1>
          ${c.specialty ? `<div class="vc-spec">${esc(c.specialty)}</div>` : ''}
          ${c.bio ? `<p class="vc-bio">${esc(c.bio)}</p>` : ''}
        </section>

        ${phone ? `<a class="btn btn-primary w-100 fw-bold vc-main" target="_blank" rel="noopener"
            href="https://wa.me/${phone}?text=${encodeURIComponent(`Hola, quiero agendar una consulta con ${d.name || 'ustedes'}`)}">
            <i class="bi bi-whatsapp me-2"></i>Agendar cita</a>` : ''}

        <div class="vc-actions">
          ${phone ? `<a class="vc-act" href="tel:+${phone}"><i class="bi bi-telephone"></i>Llamar</a>` : ''}
          ${d.email ? `<a class="vc-act" href="mailto:${esc(d.email)}"><i class="bi bi-envelope"></i>Correo</a>` : ''}
          <a class="vc-act" href="#" data-vc="share"><i class="bi bi-share"></i>Compartir</a>
          <a class="vc-act" href="#" data-vc="install" hidden><i class="bi bi-download"></i>Instalar</a>
        </div>

        ${c.address || hasMap || c.hours ? `<div class="vc-panel">
          ${c.address ? `<div class="vc-row"><i class="bi bi-geo-alt-fill"></i><div class="flex-grow-1">
              <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasMap ? `${c.lat},${c.lng}` : c.address)}" target="_blank" rel="noopener">${esc(c.address)}</a>
              ${hasMap ? '<div><button type="button" class="btn btn-link btn-sm p-0" data-vc="distance">¿A qué distancia estoy?</button><span class="small text-body-secondary" data-vc="distanceText"></span></div>' : ''}
            </div></div>` : ''}
          ${hasMap ? `<div class="vc-map"><iframe loading="lazy" title="Mapa" src="https://maps.google.com/maps?q=${c.lat},${c.lng}&z=15&output=embed"></iframe></div>` : ''}
          ${c.hours ? `<div class="vc-row"><i class="bi bi-clock-fill"></i><span class="small">${esc(c.hours)}</span></div>` : ''}
        </div>` : ''}

        ${(c.links || []).length ? `<div class="d-flex flex-column gap-2">${c.links.map((l) => `
          <a class="vc-link" href="${esc(l.url)}" target="_blank" rel="noopener"><i class="bi ${linkIcon(l.url)} vc-ic"></i><span>${esc(l.label)}</span><i class="bi bi-chevron-right"></i></a>`).join('')}</div>` : ''}

        <details class="vc-panel vc-patient">
          <summary><i class="bi bi-person-heart text-primary"></i>¿Eres paciente?</summary>
          <div class="mt-3 small">
            <div class="d-flex gap-2 mb-2"><span class="vc-step">1</span><div>Tu nutricionista te envía un <b>enlace personal</b> por WhatsApp.</div></div>
            <div class="d-flex gap-2 mb-2"><span class="vc-step">2</span><div>Ábrelo y <b>guárdalo</b>. No necesitas contraseña.</div></div>
            <div class="d-flex gap-2"><span class="vc-step">3</span><div>Ahí verás tu cuerpo, tus medidas, tu plan y tu evolución.</div></div>
          </div>
        </details>

        ${preview ? '' : `<div class="vc-foot"><a href="/${esc(slug)}/admin/"><i class="bi bi-lock me-1"></i>Acceso para profesionales</a></div>`}
      </div>`;

    const q = (k) => el.querySelector(`[data-vc="${k}"]`);
    q('share').onclick = async (ev) => {
      ev.preventDefault();
      if (preview) return;
      try {
        if (navigator.share) await navigator.share({ title: d.name, text: c.specialty || 'Consultorio de nutrición', url: pageUrl });
        else { await navigator.clipboard.writeText(pageUrl); toast('Enlace copiado'); }
      } catch { /* cancelado */ }
    };
    const dist = q('distance');
    if (dist) dist.onclick = () => {
      const out = q('distanceText');
      if (!navigator.geolocation) { out.textContent = 'Tu navegador no permite ubicación.'; return; }
      dist.disabled = true; dist.textContent = 'Calculando…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const km = haversineKm(pos.coords.latitude, pos.coords.longitude, c.lat, c.lng);
        dist.hidden = true;
        out.textContent = `📍 A ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} de ti`;
      }, () => { dist.disabled = false; dist.textContent = '¿A qué distancia estoy?'; out.textContent = ' No pudimos obtener tu ubicación.'; },
      { enableHighAccuracy: true, timeout: 10000 });
    };
    if (!preview) setupInstall(q('install'), d.name);
  }

  // ---------- instalar la tarjeta como app ----------
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; document.querySelectorAll('[data-vc="install"]').forEach((b) => (b.hidden = false)); });
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function setupInstall(btn, name) {
    if (!btn || isStandalone()) return;
    if (deferred || isIOS()) btn.hidden = false;
    btn.onclick = async (ev) => {
      ev.preventDefault();
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') { btn.hidden = true; toast('¡Listo! La tarjeta quedó en tu pantalla de inicio'); }
        deferred = null;
      } else if (isIOS()) {
        iosHelp(name);
      }
    };
  }

  function iosHelp(name) {
    const box = document.createElement('div');
    box.className = 'position-fixed bottom-0 start-0 end-0 p-3';
    box.style.zIndex = 1080;
    box.innerHTML = `<div class="vc-panel shadow-lg mx-auto" style="max-width:440px">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2"><b>Instalar ${esc(name)}</b><button class="btn-close" aria-label="Cerrar"></button></div>
        <div class="small">1. Toca <i class="bi bi-box-arrow-up"></i> <b>Compartir</b> en la barra de Safari.<br>2. Elige <b>Agregar a pantalla de inicio</b> <i class="bi bi-plus-square"></i>.</div>
      </div>`;
    document.body.appendChild(box);
    box.querySelector('.btn-close').onclick = () => box.remove();
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'position-fixed start-50 translate-middle-x badge text-bg-dark fs-6 fw-semibold px-3 py-2';
    t.style.cssText = 'bottom:24px;z-index:1090';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  return { render, linkIcon };
})();
