// Kit visual común de las apps Diwilo (sin dependencias, SVG + CSS con las variables del tema). Se carga con <script src="/m/dwviz.js"></script>
// o, desde un módulo:  await DwViz.cargar()  (si ya está, no vuelve a cargar). Todo responde a modo claro/oscuro y a celular.
//   DwViz.kpis(host, [{ titulo, valor, detalle?, icono?, tono?: 'ok'|'mal'|'aviso', delta?: número (% vs. antes), serie?: [n…], ruta? }])
//   DwViz.linea(host, { etiquetas: [..], series: [{ nombre, datos: [..], color? }], fmt?, area? })   tendencia (con puntero y valores)
//   DwViz.barras(host, { etiquetas, series: [{ nombre, datos, color? }], fmt?, apiladas? })           comparar periodos o categorías
//   DwViz.ranking(host, [{ nombre, valor, detalle?, color? }], { fmt?, max? })                         barras horizontales (top clientes, gastos…)
//   DwViz.dona(host, [{ nombre, valor, color? }], { fmt?, centro?: 'Total' })                          composición con leyenda
//   DwViz.embudo(host, [{ nombre, valor, color? }], { fmt? })                                          etapas con conversión entre ellas
//   DwViz.avance(host, { valor, total, titulo?, fmt? })                                                barra de progreso con porcentaje
//   DwViz.kanban(host, { columnas: [{ id, titulo, color?, items: [{ id, titulo, detalle?, valor?, etiqueta? }] }], mover?(id, desde, hasta), abrir?(id), fmt? })
//   DwViz.linea_de_tiempo(host, [{ fecha, titulo, detalle?, icono?, tono?, valor? }])                  historial de un registro
//   DwViz.vacio(host, { icono, titulo, texto?, accion?: { texto, hacer } })                            estado vacío con salida
//   DwViz.esqueleto(host, n)                                                                           carga elegante
//   DwViz.tarjeta(titulo, cuerpoHtml, { sub?, acciones? }) → html                                      panel con título para armar tableros
(function () {
  if (window.DwViz) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAL = ['var(--dw-p,#6d28d9)', '#22D3EE', '#34D399', '#FBBF24', '#F472B6', '#60A5FA', '#FB7185', '#A3E635'];
  const col = (c, i) => (c && /^(#[0-9a-f]{3,8}|var\([^)]+\))$/i.test(c) ? c : PAL[i % PAL.length]);
  const num = (v) => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  const corto = (v) => { const a = Math.abs(v); return a >= 1e9 ? `${(v / 1e9).toFixed(1)} mil M` : a >= 1e6 ? `${(v / 1e6).toFixed(1)} M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)} k` : String(Math.round(v)); };
  const peso = (v) => `$${num(v)}`;
  const TONO = { ok: '#16a34a', mal: '#dc2626', aviso: '#d97706' };

  const st = document.createElement('style');
  st.textContent = `.dv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:16px}
.dv-kpi{position:relative;display:flex;flex-direction:column;gap:2px;padding:14px 16px;border-radius:16px;border:1px solid var(--dw-borde,var(--bs-border-color));background:var(--dw-tarjeta,var(--bs-body-bg));color:inherit;text-decoration:none;text-align:left;overflow:hidden;transition:transform .12s,box-shadow .12s}
.dv-kpi[data-ruta]{cursor:pointer}.dv-kpi[data-ruta]:hover{transform:translateY(-2px);box-shadow:var(--bs-box-shadow)}
.dv-kpi .ic{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;margin-bottom:8px;color:var(--t,var(--dw-p,#6d28d9));background:color-mix(in srgb,var(--t,var(--dw-p,#6d28d9)) 14%,transparent)}
.dv-kpi .v{font-size:1.55rem;font-weight:700;line-height:1.1;word-break:break-word}.dv-kpi .t{font-size:.82rem;color:var(--bs-secondary-color)}.dv-kpi .d{font-size:.76rem;color:var(--bs-secondary-color);margin-top:2px}
.dv-kpi .dl{font-size:.76rem;font-weight:600}.dv-kpi .dl.up{color:#16a34a}.dv-kpi .dl.dn{color:#dc2626}
.dv-kpi svg.sp{position:absolute;right:8px;bottom:8px;width:84px;height:34px;opacity:.9}
.dv-p{border:1px solid var(--dw-borde,var(--bs-border-color));border-radius:16px;background:var(--dw-tarjeta,var(--bs-body-bg));padding:16px;height:100%}
.dv-p h3{font-size:.95rem;margin:0 0 2px}.dv-p .sub{font-size:.78rem;color:var(--bs-secondary-color);margin-bottom:10px}.dv-p .ph{display:flex;align-items:flex-start;gap:8px}.dv-p .ph>div:first-child{flex:1}
.dv-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;margin-bottom:16px}
.dv-chart{position:relative;width:100%}.dv-chart svg{display:block;width:100%;height:auto;overflow:visible}
.dv-chart text{font-size:10.5px;fill:var(--bs-secondary-color)}.dv-chart .gl{stroke:var(--bs-border-color);stroke-width:1;stroke-dasharray:3 4}
.dv-tip{position:absolute;pointer-events:none;z-index:5;background:var(--bs-body-bg);border:1px solid var(--bs-border-color);border-radius:10px;padding:6px 9px;font-size:.76rem;box-shadow:var(--bs-box-shadow);white-space:nowrap;transform:translate(-50%,-110%);display:none}
.dv-leg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.78rem;margin-top:8px}.dv-leg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px}
.dv-rk{display:grid;gap:9px}.dv-rk .r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;font-size:.84rem}.dv-rk .r b{font-weight:600}.dv-rk .r small{color:var(--bs-secondary-color)}
.dv-rk .bar{grid-column:1/-1;height:8px;border-radius:99px;background:rgba(var(--bs-body-color-rgb),.07);overflow:hidden}.dv-rk .bar i{display:block;height:100%;border-radius:99px;background:var(--c)}
.dv-dn{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.dv-dn svg{width:150px;height:150px;flex:none}.dv-dn .lg{flex:1;min-width:140px;display:grid;gap:6px;font-size:.82rem}
.dv-dn .lg div{display:flex;align-items:center;gap:7px}.dv-dn .lg i{width:10px;height:10px;border-radius:3px;flex:none}.dv-dn .lg span{margin-left:auto;font-weight:600}
.dv-em{display:grid;gap:6px}.dv-em .e{display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:center;font-size:.82rem}.dv-em .e .b{height:30px;border-radius:8px;background:var(--c);display:flex;align-items:center;padding:0 10px;color:#fff;font-weight:600;min-width:34px;transition:width .4s}
.dv-em .cv{font-size:.72rem;color:var(--bs-secondary-color);text-align:center}
.dv-av .top{display:flex;justify-content:space-between;font-size:.84rem;margin-bottom:5px}.dv-av .bar{height:10px;border-radius:99px;background:rgba(var(--bs-body-color-rgb),.08);overflow:hidden}.dv-av .bar i{display:block;height:100%;border-radius:99px;background:var(--c,var(--dw-p,#6d28d9));transition:width .5s}
.dv-kb{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x proximity}
.dv-kb .col{scroll-snap-align:start;background:rgba(var(--bs-body-color-rgb),.04);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:140px;border-top:3px solid var(--c)}
.dv-kb .col.over{outline:2px dashed var(--c);outline-offset:-4px}.dv-kb .ch{display:flex;align-items:center;gap:6px;font-weight:600;font-size:.85rem}.dv-kb .ch small{margin-left:auto;color:var(--bs-secondary-color);font-weight:500}
.dv-kb .it{background:var(--bs-body-bg);border:1px solid var(--bs-border-color);border-radius:12px;padding:10px;font-size:.84rem;cursor:grab;text-align:left;color:inherit;width:100%}.dv-kb .it:hover{border-color:var(--c)}.dv-kb .it.drag{opacity:.4}
.dv-kb .it .tt{font-weight:600}.dv-kb .it .dd{font-size:.76rem;color:var(--bs-secondary-color)}.dv-kb .it .vv{font-weight:700;margin-top:4px}.dv-kb .it .et{display:inline-block;font-size:.68rem;border-radius:99px;padding:1px 8px;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c);margin-top:4px}
.dv-kb .cv{font-size:.78rem;color:var(--bs-secondary-color);text-align:center;padding:14px 0}
.dv-tl{position:relative;display:grid;gap:14px;padding-left:26px}.dv-tl:before{content:"";position:absolute;left:9px;top:4px;bottom:4px;width:2px;background:var(--bs-border-color)}
.dv-tl .n{position:relative;font-size:.84rem}.dv-tl .n:before{content:"";position:absolute;left:-23px;top:3px;width:12px;height:12px;border-radius:50%;background:var(--t,var(--dw-p,#6d28d9));box-shadow:0 0 0 3px var(--bs-body-bg)}
.dv-tl .n small{display:block;color:var(--bs-secondary-color);font-size:.74rem}.dv-tl .n .v{font-weight:600;float:right}
.dv-vc{text-align:center;padding:34px 16px;color:var(--bs-secondary-color)}.dv-vc .ic{width:62px;height:62px;border-radius:20px;display:inline-grid;place-items:center;font-size:1.7rem;color:var(--dw-p,#6d28d9);background:color-mix(in srgb,var(--dw-p,#6d28d9) 12%,transparent);margin-bottom:12px}
.dv-vc b{display:block;color:var(--bs-body-color);font-size:1rem;margin-bottom:4px}.dv-vc p{margin:0 auto 12px;max-width:340px;font-size:.86rem}
.dv-sk{height:84px;border-radius:16px;margin-bottom:12px;background:linear-gradient(90deg,rgba(var(--bs-body-color-rgb),.05),rgba(var(--bs-body-color-rgb),.11),rgba(var(--bs-body-color-rgb),.05));background-size:200% 100%;animation:dvsk 1.2s infinite}@keyframes dvsk{to{background-position:-200% 0}}
@media(max-width:575.98px){.dv-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dv-kpi{padding:12px}.dv-kpi .v{font-size:1.2rem}.dv-kpi svg.sp{width:60px}}
@media(prefers-reduced-motion:reduce){.dv-sk{animation:none}.dv-kpi,.dv-em .b,.dv-av .bar i{transition:none}}`;
  document.head.appendChild(st);

  const ejes = (max) => { // 4 líneas guía con números redondos
    const paso = Math.pow(10, Math.floor(Math.log10(max || 1))), m = [1, 2, 2.5, 5, 10].map((k) => k * paso).find((p) => p * 4 >= max) || paso * 10;
    return { tope: m * 4, marcas: [0, 1, 2, 3, 4].map((i) => m * i) };
  };
  function tip(host) {
    host.style.position = 'relative';
    const t = document.createElement('div'); t.className = 'dv-tip'; host.appendChild(t);
    return { show(x, y, html) { t.innerHTML = html; t.style.left = `${x}px`; t.style.top = `${y}px`; t.style.display = 'block'; }, hide() { t.style.display = 'none'; } };
  }
  const leyenda = (series) => (series.length > 1 ? `<div class="dv-leg">${series.map((s, i) => `<span><i style="background:${col(s.color, i)}"></i>${esc(s.nombre)}</span>`).join('')}</div>` : '');

  const D = {
    cargar() { return Promise.resolve(); },
    tarjeta(titulo, cuerpo, { sub = '', acciones = '' } = {}) {
      return `<div class="dv-p"><div class="ph"><div><h3>${esc(titulo)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${acciones}</div>${cuerpo}</div>`;
    },
    spark(datos, color = 'var(--dw-p,#6d28d9)') {
      if (!datos || datos.length < 2) return '';
      const mx = Math.max(...datos), mn = Math.min(...datos), W = 84, H = 34, r = mx - mn || 1;
      const pts = datos.map((v, i) => `${(i / (datos.length - 1) * W).toFixed(1)},${(H - 4 - ((v - mn) / r) * (H - 8)).toFixed(1)}`).join(' ');
      return `<svg class="sp" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polygon points="0,${H} ${pts} ${W},${H}" fill="${color}" opacity=".13"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    },
    kpis(host, items) {
      host.innerHTML = `<div class="dv-kpis">${items.map((k) => {
        const tag = k.ruta ? 'a' : 'div', t = TONO[k.tono] || 'var(--dw-p,#6d28d9)';
        const dl = typeof k.delta === 'number' && isFinite(k.delta) ? `<span class="dl ${k.delta >= 0 ? 'up' : 'dn'}"><i class="bi bi-arrow-${k.delta >= 0 ? 'up' : 'down'}-short"></i>${Math.abs(Math.round(k.delta))}%</span>` : '';
        return `<${tag} class="dv-kpi" style="--t:${t}" ${k.ruta ? `href="${esc(k.ruta)}" data-ruta="${esc(k.ruta)}"` : ''}>${k.icono ? `<span class="ic"><i class="bi ${esc(k.icono)}"></i></span>` : ''}
          <span class="v">${esc(k.valor)}</span><span class="t">${esc(k.titulo)}</span>${dl}${k.detalle ? `<span class="d">${esc(k.detalle)}</span>` : ''}${D.spark(k.serie, t)}</${tag}>`;
      }).join('')}</div>`;
    },
    linea(host, { etiquetas = [], series = [], fmt = peso, area = true } = {}) {
      if (!etiquetas.length || !series.some((s) => s.datos.some((v) => v))) return D.vacio(host, { icono: 'bi-graph-up', titulo: 'Aún no hay datos para graficar', texto: 'Cuando registres movimientos, aquí verás la tendencia.' });
      const W = 560, H = 210, L = 44, R = 10, T = 10, B = 24, max = Math.max(...series.flatMap((s) => s.datos), 1), { tope, marcas } = ejes(max);
      const x = (i) => L + (etiquetas.length === 1 ? (W - L - R) / 2 : (i / (etiquetas.length - 1)) * (W - L - R)), y = (v) => T + (1 - v / tope) * (H - T - B);
      let g = marcas.map((m) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/><text x="${L - 6}" y="${y(m) + 3}" text-anchor="end">${corto(m)}</text>`).join('');
      const paso = Math.ceil(etiquetas.length / 8);
      g += etiquetas.map((e, i) => (i % paso === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(e)}</text>` : '')).join('');
      series.forEach((s, k) => {
        const c = col(s.color, k), pts = s.datos.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        if (area && series.length <= 2) g += `<polygon points="${x(0)},${y(0)} ${pts.join(' ')} ${x(s.datos.length - 1)},${y(0)}" fill="${c}" opacity=".10"/>`;
        g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
        if (etiquetas.length <= 24) g += s.datos.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${c}"/>`).join('');
      });
      host.innerHTML = `<div class="dv-chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}<line data-cur class="gl" y1="${T}" y2="${H - B}" style="display:none"/><rect data-hit x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg></div>${leyenda(series)}`;
      const box = host.querySelector('.dv-chart'), svg = box.querySelector('svg'), tp = tip(box), cur = svg.querySelector('[data-cur]');
      const mover = (ev) => {
        const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W, i = Math.max(0, Math.min(etiquetas.length - 1, Math.round(((px - L) / (W - L - R)) * (etiquetas.length - 1))));
        cur.style.display = ''; cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i));
        tp.show((x(i) / W) * r.width, (y(Math.max(...series.map((s) => s.datos[i]))) / H) * r.height, `<b>${esc(etiquetas[i])}</b>${series.map((s, k) => `<div><i class="d-inline-block rounded-circle me-1" style="width:8px;height:8px;background:${col(s.color, k)}"></i>${series.length > 1 ? `${esc(s.nombre)}: ` : ''}${esc(fmt(s.datos[i]))}</div>`).join('')}`);
      };
      svg.addEventListener('pointermove', mover); svg.addEventListener('pointerleave', () => { tp.hide(); cur.style.display = 'none'; });
    },
    barras(host, { etiquetas = [], series = [], fmt = peso, apiladas = false } = {}) {
      if (!etiquetas.length || !series.some((s) => s.datos.some((v) => v))) return D.vacio(host, { icono: 'bi-bar-chart', titulo: 'Aún no hay datos para graficar', texto: 'Cuando haya movimiento verás aquí la comparación.' });
      const W = 560, H = 210, L = 44, R = 10, T = 10, B = 24, n = etiquetas.length;
      const tot = (i) => series.reduce((t, s) => t + (s.datos[i] || 0), 0), max = Math.max(...(apiladas ? etiquetas.map((_, i) => tot(i)) : series.flatMap((s) => s.datos)), 1), { tope, marcas } = ejes(max);
      const y = (v) => T + (1 - v / tope) * (H - T - B), ancho = (W - L - R) / n, bw = Math.min(34, (ancho * 0.7) / (apiladas ? 1 : series.length));
      let g = marcas.map((m) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/><text x="${L - 6}" y="${y(m) + 3}" text-anchor="end">${corto(m)}</text>`).join('');
      const paso = Math.ceil(n / 10);
      etiquetas.forEach((e, i) => {
        const cx = L + ancho * i + ancho / 2;
        if (i % paso === 0) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(e)}</text>`;
        let acum = 0;
        series.forEach((s, k) => {
          const v = s.datos[i] || 0, c = col(s.color, k), bx = apiladas ? cx - bw / 2 : cx - (bw * series.length) / 2 + bw * k;
          const y0 = apiladas ? y(acum + v) : y(v), h = Math.max(0, (apiladas ? y(acum) : y(0)) - y0); acum += v;
          g += `<rect data-i="${i}" x="${bx.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${c}"/>`;
        });
      });
      host.innerHTML = `<div class="dv-chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>${leyenda(series)}`;
      const box = host.querySelector('.dv-chart'), svg = box.querySelector('svg'), tp = tip(box);
      svg.addEventListener('pointermove', (ev) => {
        const r = svg.getBoundingClientRect(), i = Math.floor((((ev.clientX - r.left) / r.width) * W - L) / ancho);
        if (i < 0 || i >= n) return tp.hide();
        tp.show(((L + ancho * i + ancho / 2) / W) * r.width, 10, `<b>${esc(etiquetas[i])}</b>${series.map((s, k) => `<div><i class="d-inline-block rounded-circle me-1" style="width:8px;height:8px;background:${col(s.color, k)}"></i>${series.length > 1 ? `${esc(s.nombre)}: ` : ''}${esc(fmt(s.datos[i] || 0))}</div>`).join('')}`);
      });
      svg.addEventListener('pointerleave', tp.hide);
    },
    ranking(host, filas, { fmt = peso, max } = {}) {
      if (!filas?.length) return D.vacio(host, { icono: 'bi-trophy', titulo: 'Sin datos todavía' });
      const m = max || Math.max(...filas.map((f) => f.valor), 1);
      host.innerHTML = `<div class="dv-rk">${filas.map((f, i) => `<div class="r" style="--c:${col(f.color, i)}"><div><b>${esc(f.nombre)}</b>${f.detalle ? ` <small>${esc(f.detalle)}</small>` : ''}</div><b>${esc(fmt(f.valor))}</b><div class="bar"><i style="width:${Math.max(2, (f.valor / m) * 100)}%"></i></div></div>`).join('')}</div>`;
    },
    dona(host, filas, { fmt = peso, centro = 'Total' } = {}) {
      const datos = (filas || []).filter((f) => f.valor > 0), total = datos.reduce((t, f) => t + f.valor, 0);
      if (!total) return D.vacio(host, { icono: 'bi-pie-chart', titulo: 'Sin datos todavía' });
      const R = 56, C = 2 * Math.PI * R; let off = 0;
      const arcos = datos.map((f, i) => { const l = (f.valor / total) * C, a = `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${col(f.color, i)}" stroke-width="22" stroke-dasharray="${Math.max(0, l - 1.5).toFixed(2)} ${(C - l + 1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 75 75)"><title>${esc(f.nombre)}: ${esc(fmt(f.valor))}</title></circle>`; off += l; return a; }).join('');
      host.innerHTML = `<div class="dv-dn"><svg viewBox="0 0 150 150" role="img">${arcos}<text x="75" y="72" text-anchor="middle" style="font-size:10px">${esc(centro)}</text><text x="75" y="90" text-anchor="middle" style="font-size:14px;font-weight:700;fill:var(--bs-body-color)">${esc(fmt(total))}</text></svg>
        <div class="lg">${datos.map((f, i) => `<div><i style="background:${col(f.color, i)}"></i>${esc(f.nombre)}<span>${Math.round((f.valor / total) * 100)}%</span></div>`).join('')}</div></div>`;
    },
    embudo(host, etapas, { fmt = num } = {}) {
      if (!etapas?.length) return D.vacio(host, { icono: 'bi-funnel', titulo: 'Sin etapas todavía' });
      const m = Math.max(...etapas.map((e) => e.valor), 1);
      host.innerHTML = `<div class="dv-em">${etapas.map((e, i) => {
        const prev = i ? etapas[i - 1].valor : 0, cv = i && prev ? `<div class="cv">↓ ${Math.round((e.valor / prev) * 100)}% pasa a la siguiente</div>` : '';
        return `${cv}<div class="e" style="--c:${col(e.color, i)}"><span>${esc(e.nombre)}</span><div class="b" style="width:${Math.max(8, (e.valor / m) * 100)}%">${esc(fmt(e.valor))}</div></div>`;
      }).join('')}</div>`;
    },
    avance(host, { valor = 0, total = 0, titulo = '', fmt = peso, color } = {}) {
      const p = total ? Math.min(100, Math.round((valor / total) * 100)) : 0;
      host.innerHTML = `<div class="dv-av"><div class="top"><span>${esc(titulo)}</span><b>${p}% · ${esc(fmt(valor))} de ${esc(fmt(total))}</b></div><div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%;${color ? `--c:${col(color, 0)}` : ''}"></i></div></div>`;
    },
    kanban(host, { columnas = [], mover, abrir, fmt = peso } = {}) {
      const html = `<div class="dv-kb">${columnas.map((c, i) => `<div class="col" data-col="${esc(c.id)}" style="--c:${col(c.color, i)}"><div class="ch">${esc(c.titulo)}<small>${c.items.length}${c.items.some((x) => x.valor) ? ` · ${esc(fmt(c.items.reduce((t, x) => t + (x.valor || 0), 0)))}` : ''}</small></div>
        ${c.items.map((x) => `<button type="button" class="it" draggable="${mover ? 'true' : 'false'}" data-id="${esc(x.id)}"><div class="tt">${esc(x.titulo)}</div>${x.detalle ? `<div class="dd">${esc(x.detalle)}</div>` : ''}${x.valor ? `<div class="vv">${esc(fmt(x.valor))}</div>` : ''}${x.etiqueta ? `<span class="et">${esc(x.etiqueta)}</span>` : ''}</button>`).join('') || '<div class="cv">Vacío</div>'}</div>`).join('')}</div>`;
      host.innerHTML = html;
      let arrastre = null;
      host.querySelectorAll('.it').forEach((b) => {
        b.addEventListener('click', () => abrir?.(b.dataset.id));
        b.addEventListener('dragstart', (e) => { arrastre = { id: b.dataset.id, desde: b.closest('.col').dataset.col }; b.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', b.dataset.id); } catch { /* Safari */ } });
        b.addEventListener('dragend', () => { b.classList.remove('drag'); host.querySelectorAll('.col').forEach((c) => c.classList.remove('over')); });
      });
      host.querySelectorAll('.col').forEach((c) => {
        c.addEventListener('dragover', (e) => { if (arrastre) { e.preventDefault(); c.classList.add('over'); } });
        c.addEventListener('dragleave', () => c.classList.remove('over'));
        c.addEventListener('drop', (e) => { e.preventDefault(); c.classList.remove('over'); if (arrastre && arrastre.desde !== c.dataset.col) mover?.(arrastre.id, arrastre.desde, c.dataset.col); arrastre = null; });
      });
    },
    linea_de_tiempo(host, eventos, { fmt = peso } = {}) {
      if (!eventos?.length) return D.vacio(host, { icono: 'bi-clock-history', titulo: 'Sin historial todavía', texto: 'Aquí aparecerá cada cosa que pase con este registro.' });
      host.innerHTML = `<div class="dv-tl">${eventos.map((e) => `<div class="n" style="--t:${TONO[e.tono] || 'var(--dw-p,#6d28d9)'}">${e.valor ? `<span class="v">${esc(fmt(e.valor))}</span>` : ''}<b>${e.icono ? `<i class="bi ${esc(e.icono)} me-1"></i>` : ''}${esc(e.titulo)}</b>${e.detalle ? `<small>${esc(e.detalle)}</small>` : ''}<small>${esc(e.fecha || '')}</small></div>`).join('')}</div>`;
    },
    vacio(host, { icono = 'bi-inbox', titulo = 'Nada por aquí', texto = '', accion } = {}) {
      host.innerHTML = `<div class="dv-vc"><span class="ic"><i class="bi ${esc(icono)}"></i></span><b>${esc(titulo)}</b>${texto ? `<p>${esc(texto)}</p>` : ''}${accion ? `<button type="button" class="btn btn-primary btn-sm" data-vacio>${esc(accion.texto)}</button>` : ''}</div>`;
      if (accion) host.querySelector('[data-vacio]').addEventListener('click', accion.hacer);
    },
    esqueleto(host, n = 3) { host.innerHTML = Array.from({ length: n }, () => '<div class="dv-sk"></div>').join(''); },
    // utilidades para calcular los datos de los tableros
    ultimosMeses(n = 6) { const out = [], d = new Date(); d.setDate(1); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push({ clave: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, etiqueta: x.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '') }); } return out; },
    variacion(actual, antes) { return antes ? ((actual - antes) / Math.abs(antes)) * 100 : undefined; },
  };
  window.DwViz = D;
})();
