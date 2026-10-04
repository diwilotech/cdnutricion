// Cuerpo Vivo: la vista del paciente, para la nutricionista y para el paciente, sobre datos reales.
// CuerpoVivo.start({ root, mode:'nutri'|'paciente', canSwitch, data, api, userName, userInitials })
window.CuerpoVivo = { async start(cfg){
cfg.root.innerHTML = await (await fetch('/cv/cuerpo.part')).text();
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmt = (n, d = 1) => n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fecha = iso => { const [y,m,d] = iso.split('-').map(Number); return `${d} ${MESES[m-1]}`; };

const D = cfg.data, API = cfg.api || {}, TODAY = D.today, P0 = D.patient;
const SEXO = P0.sex || 'F';
const ageAt = b => { if (!b) return null; const [y,m,d] = b.split('-').map(Number), [ty,tm,td] = TODAY.split('-').map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); };
// Historial para la figura: consultas con peso; si falta grasa o músculo se usa el último conocido.
const DEF = SEXO === 'M' ? { grasa:22, mus:33 } : { grasa:28, mus:26 };
let carry = { ...DEF };
const HIST = D.consultations.filter(x => x.weight_kg).map(x => { carry = { grasa:x.fat_pct ?? carry.grasa, mus:x.muscle_pct ?? carry.mus }; return { id:x.id, f:x.date, peso:x.weight_kg, ...carry }; });
const PACIENTES = [{
  id:P0.id, nombre:`${P0.first_name} ${P0.last_name || ''}`.trim(),
  ini:((P0.first_name || '?')[0] + ((P0.last_name || '')[0] || '')).toUpperCase(),
  sexo:SEXO, edad:ageAt(P0.birth_date) ?? 30, talla:P0.height_cm || (SEXO === 'M' ? 172 : 160),
  hist:HIST, mediciones:D.consultations.map(x => ({ id:x.id, f:x.date, med:{ ...x.measures } })), draft:null,
}];
const NUTRI = D.business;
const RECS = { [P0.id]: D.recs.map(r => ({ id:r.id, txt:r.text, f:r.created_at.slice(0, 10), autor:r.author })) };
const NIVELES = ['Semilla','Brote','Raíz firme','En forma','Pleno'];
const UMBRAL = [0,40,60,75,90];

const S = { rol:cfg.mode, pid:P0.id, tab:'cuerpo', vista:'capas', sim:null, cur:null, lastLevel:null, play:null, idx:HIST.length - 1 };
let SAVERS = null;
const persistAll = () => SAVERS && SAVERS.forEach(f => f());

/* ---------- Métricas ---------- */
function metr(s){
  const imc = s.peso / Math.pow(s.talla/100, 2);
  const bmiS = imc < 18.5 ? 100 - (18.5-imc)*12 : imc < 25 ? 100 : 100 - (imc-24.9)*10;
  const [fl,fh] = s.sexo === 'M' ? [10,20] : [18,28];
  const fatS = s.grasa < fl ? 100 - (fl-s.grasa)*6 : s.grasa <= fh ? 100 : 100 - (s.grasa-fh)*6;
  const mmin = s.sexo === 'M' ? 35 : 26;
  const musS = s.mus >= mmin ? 100 : 100 - (mmin-s.mus)*8;
  const score = Math.round(clamp(.35*clamp(bmiS,0,100) + .4*clamp(fatS,0,100) + .25*clamp(musS,0,100), 0, 100));
  let lv = 1; UMBRAL.forEach((u,i) => { if (score >= u) lv = i+1; });
  const imcCat = imc < 18.5 ? ['Bajo peso','--water'] : imc < 25 ? ['Normal','--good'] : imc < 30 ? ['Sobrepeso','--warn'] : ['Obesidad','--bad'];
  const fatCat = s.grasa < fl ? ['Baja','--water'] : s.grasa <= fh ? ['Saludable','--good'] : s.grasa <= fh+6 ? ['Elevada','--warn'] : ['Alta','--bad'];
  const musCat = s.mus >= mmin ? ['Buena','--good'] : s.mus >= mmin-4 ? ['Mejorable','--warn'] : ['Baja','--bad'];
  const estado = score >= 90 ? 'Excelente' : score >= 75 ? 'Buena' : score >= 60 ? 'Aceptable' : score >= 40 ? 'En riesgo' : 'Prioridad alta';
  const color = score >= 75 ? '--good' : score >= 60 ? '--warn' : '--bad';
  return { imc, score, lv, imcCat, fatCat, musCat, estado, color, fh, mmin };
}

/* ---------- Figura ---------- */
const NS = 'http://www.w3.org/2000/svg';
function mk(tag, cls){ const e = document.createElementNS(NS, tag); if (cls) e.setAttribute('class', cls); return e; }
function buildLayer(g){
  const L = { body:mk('path','solid'), armL:mk('path','solid'), armR:mk('path','solid') };
  g.appendChild(L.armL); g.appendChild(L.armR); g.appendChild(L.body);
  return L;
}
const LAY = { haloA:buildLayer($('#lHaloA')), haloB:buildLayer($('#lHaloB')), fat:buildLayer($('#lFat')), musO:buildLayer($('#lMusO')), core:buildLayer($('#lCore')) };
(function grid(){ const g = $('#gridLines'); for (let y = 20; y < 420; y += 20){ const l = mk('line','bodygrid'); l.setAttribute('x1',0); l.setAttribute('x2',260); l.setAttribute('y1',y); l.setAttribute('y2',y); g.appendChild(l); } })();

/* Plantillas de silueta (lado derecho, x desde el centro). Mismo número de puntos en las cuatro para poder interpolar. */
const TPL = {
  ML:{ body:[[0,12],[10,15],[14,24],[14.5,34],[12,45],[7,53],[7.5,60],[17,67],[29,73],[33,84],[25,98],[24,112],[22,130],[19.5,150],[21,170],[24,190],[25,208],[23,235],[20,265],[16,292],[17.5,318],[14,350],[9.5,380],[11,394],[13.5,402],[5.5,403],[5.5,385],[6.5,345],[8,320],[6.5,295],[5,262],[3.5,232],[0,220]],
       arm:[[24,70],[31,74],[35,84],[36,100],[36,122],[37,142],[36,165],[38,178],[37,192],[33,198],[30,192],[30,176],[30.5,165],[30,142],[29,122],[28,102],[26,90]] },
  MO:{ body:[[0,12],[11,15],[15.5,24],[16.5,35],[15,46],[10,55],[11,61],[20,67],[31,74],[36,86],[31,98],[35,115],[39,135],[42,155],[43,175],[40,195],[37,212],[33,238],[27,268],[21,293],[21,318],[16,350],[11,380],[12.5,394],[14.5,402],[5,403],[5,385],[6.5,345],[7.5,320],[6,297],[2.5,262],[1.5,235],[0,224]],
       arm:[[27,70],[34,74],[39,86],[41,103],[40,124],[40,144],[39,166],[41,179],[40,193],[36,199],[33,193],[33,177],[33,166],[34,144],[34,124],[34,104],[30,90]] },
  FL:{ body:[[0,12],[11,14],[15,22],[16,34],[17,48],[14,56],[6.5,60],[15,67],[25,73],[28,82],[21,97],[21,110],[18,128],[16,147],[21,170],[26,190],[26,207],[23,235],[19,265],[14.5,292],[15.5,318],[12,350],[8,380],[9.5,394],[11.5,401],[4.8,402],[4.8,385],[6,345],[7,320],[5.5,295],[4,262],[2.5,232],[0,222]],
       arm:[[20,70],[26,73],[29,82],[29.5,100],[29,121],[30,141],[29.5,163],[31,176],[30.5,189],[27,195],[24.5,189],[24.5,174],[25,163],[25,141],[24,121],[23.5,102],[22,88]] },
  FO:{ body:[[0,12],[12,14],[16,22],[17,34],[18,48],[15,57],[9,61],[19,67],[28,73],[32,84],[28,98],[31,112],[33,130],[34,150],[37,172],[39,192],[37,210],[32,238],[26,268],[19,294],[19.5,318],[15,350],[10,380],[11.5,394],[13.5,401],[4.5,402],[4.5,385],[6,345],[7,320],[5.5,296],[2,262],[1,235],[0,224]],
       arm:[[23,70],[30,73],[34,84],[36,102],[35,124],[35,144],[34,165],[36,178],[35,191],[31,197],[28,191],[28,176],[28,165],[29,144],[29,124],[29,104],[26,90]] },
};
// peso del músculo por punto (hombros, brazos, muslos, pantorrillas)
const MW = { 7:.4, 8:1, 9:1.2, 10:.5, 11:.5, 17:.8, 18:.7, 20:.9, 21:.5 };
const mixP = (A, B, t) => A.map((p,i) => [p[0] + (B[i][0]-p[0])*t, p[1] + (B[i][1]-p[1])*t]);
function shape(f, m, sx){
  const tM = clamp((f - .10) / .28, -.3, 1.3), tF = clamp((f - .20) / .25, -.3, 1.3);
  const mb = mixP(TPL.ML.body, TPL.MO.body, tM), ma = mixP(TPL.ML.arm, TPL.MO.arm, tM);
  const fb = mixP(TPL.FL.body, TPL.FO.body, tF), fa = mixP(TPL.FL.arm, TPL.FO.arm, tF);
  let body = mixP(fb, mb, sx), arm = mixP(fa, ma, sx);
  const u = clamp((m - (.27 + .08*sx)) / .1, -1, 2);
  body = body.map((p,i) => [p[0] + (MW[i] || 0) * u * 2.4, p[1]]);
  arm = arm.map((p,i) => {
    const out = i >= 1 && i <= 8 ? 1.6 : i >= 10 ? -.4 : 0;
    const spread = Math.max(0, p[1] - 80) * .11;   // brazos un poco abiertos
    return [p[0] + u*out + spread + u*1.2, p[1]];
  });
  return { body, arm };
}
function crPath(pts){ // Catmull-Rom cerrado a Bézier
  const n = pts.length, P = i => pts[(i + n) % n];
  let d = `M${P(0)[0].toFixed(2)},${P(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++){
    const p0 = P(i-1), p1 = P(i), p2 = P(i+1), p3 = P(i+2);
    const c1 = [p1[0] + (p2[0]-p0[0])/6, p1[1] + (p2[1]-p0[1])/6], c2 = [p2[0] - (p3[0]-p1[0])/6, p2[1] - (p3[1]-p1[1])/6];
    d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d + 'Z';
}
const CX = 130;
function draw(L, sh, e = 0){
  const R = sh.body.map(([x,y]) => [CX + x, y]);
  const Lf = sh.body.slice(1, -1).reverse().map(([x,y]) => [CX - x, y]);
  L.body.setAttribute('d', crPath(R.concat(Lf)));
  L.armR.setAttribute('d', crPath(sh.arm.map(([x,y]) => [CX + x, y])));
  L.armL.setAttribute('d', crPath(sh.arm.map(([x,y]) => [CX - x, y]).reverse()));
  [L.body, L.armL, L.armR].forEach(p => p.setAttribute('stroke-width', 2*e));
}
function render(){
  const c = S.cur;
  const so = shape(c.f, c.m, c.sx), si = shape(.16 - .08*c.sx, c.m, c.sx);
  const sil = S.vista === 'silueta';
  draw(LAY.haloA, so, 7.5); draw(LAY.haloB, so, 3.8); draw(LAY.fat, so, 0);
  draw(LAY.musO, si, 2); draw(LAY.core, sil ? so : si, 0);
  const B = so.body, A = so.arm;
  // cinta métrica en la cintura
  const wy = B[13][1] + 2, rx = B[13][0] + 5, ry = 5 + Math.max(0, B[13][0] - 20) * .12;
  $('#tapeBack').setAttribute('d', `M${CX-rx},${wy} A${rx},${ry} 0 0 1 ${CX+rx},${wy}`);
  const front = `M${CX-rx},${wy} A${rx},${ry} 0 0 0 ${CX+rx},${wy}`;
  $('#tapeFront').setAttribute('d', front + ` M${CX+rx},${wy} q14,10 22,34`);
  $('#tapeTicks').setAttribute('d', front);
  S.geo = so;
  if (S.vista === 'medidas') drawRings(so);
  if (S.vista === 'silueta') drawLesions(so);
  // llamadas
  const armX = CX - A[3][0] - 1, armY = A[3][1] + 4, fatX = CX + B[13][0] + 2;
  $('#cl1').setAttribute('x2', armX); $('#cl1').setAttribute('y2', armY); $('#cd1').setAttribute('cx', armX); $('#cd1').setAttribute('cy', armY);
  $('#cl2').setAttribute('x2', fatX); $('#cd2').setAttribute('cx', fatX); $('#cl2').setAttribute('y2', B[13][1]); $('#cd2').setAttribute('cy', B[13][1]);
  $('#shadow').setAttribute('rx', 30 + B[16][0] * 1.3);
}
/* Cintas de medición sobre la figura */
const RINGS = [
  { k:'cuello', n:'CUELLO', side:'L', ly:50 }, { k:'brazoR', n:'BRAZO', side:'L', ly:112 },
  { k:'muslo', n:'MUSLO', side:'L', ly:240 }, { k:'pantorrilla', n:'PANTORRILLA', side:'L', ly:322 },
  { k:'pecho', n:'PECHO', side:'R', ly:104 }, { k:'cintura', n:'CINTURA', side:'R', ly:150 }, { k:'cadera', n:'CADERA', side:'R', ly:196 },
];
function ringPos(k, sh){
  const B = sh.body, A = sh.arm;
  const leg = (o, i) => ({ x: CX - (B[o][0] + B[i][0]) / 2, y: (B[o][1] + B[i][1]) / 2, rx: (B[o][0] - B[i][0]) / 2 + 2, ry:3.5 });
  switch (k){
    case 'cuello': return { x:CX, y:B[6][1] - 2, rx:B[6][0] + 1.5, ry:2.5 };
    case 'pecho': return { x:CX, y:B[11][1], rx:B[11][0] + 2, ry:5 };
    case 'cintura': return { x:CX, y:B[13][1], rx:B[13][0] + 2, ry:5 };
    case 'cadera': return { x:CX, y:B[15][1], rx:B[15][0] + 2, ry:5 };
    case 'brazoR': return { x: CX - (A[3][0] + A[15][0]) / 2, y: (A[3][1] + A[15][1]) / 2, rx: (A[3][0] - A[15][0]) / 2 + 2, ry:3 };
    case 'muslo': return leg(17, 31);
    default: return leg(20, 28);
  }
}
const RE = {};
(function buildRings(){
  const g = $('#medG');
  RINGS.forEach(r => {
    const e = { el:mk('ellipse'), ln:mk('line'), k:mk('text','k'), v:mk('text') };
    const L = r.side === 'L';
    e.k.setAttribute('x', L ? 8 : 252); e.v.setAttribute('x', L ? 8 : 252);
    e.k.setAttribute('y', r.ly - 4); e.v.setAttribute('y', r.ly + 8);
    if (!L){ e.k.setAttribute('text-anchor','end'); e.v.setAttribute('text-anchor','end'); }
    e.k.textContent = r.n;
    Object.values(e).forEach(x => g.appendChild(x));
    RE[r.k] = e;
  });
})();
function drawRings(p){
  RINGS.forEach(r => {
    const q = ringPos(r.k, p), e = RE[r.k], L = r.side === 'L';
    e.el.setAttribute('cx', q.x); e.el.setAttribute('cy', q.y); e.el.setAttribute('rx', q.rx); e.el.setAttribute('ry', q.ry);
    e.ln.setAttribute('x1', L ? 62 : 198); e.ln.setAttribute('y1', r.ly + 2);
    e.ln.setAttribute('x2', L ? q.x - q.rx : q.x + q.rx); e.ln.setAttribute('y2', q.y);
  });
}
function tick(){
  if (S.target){
    const t = S.target, c = S.cur;
    const k = .09;
    let moving = false;
    ['f','m','sx'].forEach(p => { const d = t[p] - c[p]; if (Math.abs(d) > .0005){ c[p] += d*k; moving = true; } else c[p] = t[p]; });
    if (moving || !S.drawn){ render(); S.drawn = true; }
  }
  requestAnimationFrame(tick);
}

/* ---------- UI ---------- */
const pac = () => PACIENTES.find(p => p.id === S.pid);
function loadSim(i){
  const p = pac(), h = p.hist[i ?? p.hist.length-1] || { peso:SEXO === 'M' ? 75 : 62, ...DEF };
  S.sim = { peso:h.peso, talla:p.talla, grasa:h.grasa, mus:h.mus, sexo:p.sexo };
  syncInputs();
}
function syncInputs(){
  $('#inPeso').value = S.sim.peso; $('#inTalla').value = S.sim.talla; $('#inGrasa').value = S.sim.grasa; $('#inMus').value = S.sim.mus;
  $('#sxF').setAttribute('aria-pressed', S.sim.sexo === 'F'); $('#sxM').setAttribute('aria-pressed', S.sim.sexo === 'M');
}
function update(){
  const s = S.sim, m = metr(s);
  S.target = { f:s.grasa/100, m:s.mus/100, sx: s.sexo === 'M' ? 1 : 0 };
  if (!S.cur) S.cur = { ...S.target };
  $('#oPeso').textContent = `${fmt(s.peso, s.peso%1?1:0)} kg`;
  $('#oTalla').textContent = `${s.talla} cm`;
  $('#oGrasa').textContent = `${fmt(s.grasa, s.grasa%1?1:0)} %`;
  $('#oMus').textContent = `${fmt(s.mus, s.mus%1?1:0)} %`;
  $('#tMus').textContent = `${fmt(s.mus, s.mus%1?1:0)} %`;
  $('#tFat').textContent = `${fmt(s.grasa, s.grasa%1?1:0)} %`;
  $('#tImc').textContent = fmt(m.imc);
  $('#sPeso').textContent = fmt(s.peso, s.peso%1?1:0);
  $('#sImc').textContent = fmt(m.imc);
  setCat('#sImcCat', m.imcCat); setCat('#sGrasaCat', m.fatCat, `${fmt(s.peso*s.grasa/100)} kg · `); setCat('#sMusCat', m.musCat, `${fmt(s.peso*s.mus/100)} kg · `);
  $('#sGrasa').textContent = `${fmt(s.grasa, s.grasa%1?1:0)}%`;
  $('#sMus').textContent = `${fmt(s.mus, s.mus%1?1:0)}%`;
  // anillo
  const C = 314.16;
  $('#ringVal').style.strokeDashoffset = C * (1 - m.score/100);
  $('#ringVal').style.stroke = `var(${m.color})`;
  animateNum($('#score'), m.score);
  $('#stateTxt').textContent = m.estado; $('#stateTxt').style.color = `var(${m.color})`;
  $('#shadow').setAttribute('fill', `var(${m.color})`);
  $('#lHaloA').style.setProperty('--hc', `var(${m.color})`);
  $('#legHalo').style.background = `var(${m.color})`;
  $$('#levels div').forEach((d,i) => d.classList.toggle('on', i < m.lv));
  $('#lvNum').textContent = m.lv; $('#lvName').textContent = NIVELES[m.lv-1];
  $('#lvNext').textContent = m.lv < 5 ? `· faltan ${UMBRAL[m.lv]-m.score} puntos para ${NIVELES[m.lv]}` : '· nivel máximo';
  // IMC
  const pos = clamp((m.imc - 15) / 25, 0, 1);
  const zones = [[15,18.5,0,14],[18.5,25,14,40],[25,30,40,60],[30,40,60,100]];
  let left = 0; zones.forEach(([a,b,x0,x1]) => { if (m.imc >= a) left = x0 + (Math.min(m.imc,b)-a)/(b-a)*(x1-x0); });
  $('#imcMarker').style.left = `calc(${clamp(left,0,100)}% - 2px)`;
  // nivel
  if (S.lastLevel != null && m.lv > S.lastLevel){ burst(); toast(`Subió a nivel ${m.lv}: ${NIVELES[m.lv-1]}`); }
  S.lastLevel = m.lv;
  chips(m);
  refreshMedidas();
}
function setCat(sel, [txt, col], pre = ''){ const e = $(sel); e.textContent = pre + txt; e.style.color = `var(${col})`; }
function animateNum(el, to){
  const from = Number(el.textContent) || 0; const t0 = performance.now();
  cancelAnimationFrame(el._r);
  const step = t => { const k = clamp((t - t0)/600, 0, 1); el.textContent = Math.round(from + (to-from)*(1 - Math.pow(1-k,3))); if (k < 1) el._r = requestAnimationFrame(step); };
  el._r = requestAnimationFrame(step);
}
function burst(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const b = $('#burst'); b.innerHTML = '';
  const cols = ['--accent','--fat','--muscle','--water','--good'];
  for (let i = 0; i < 22; i++){
    const s = document.createElement('span'); const a = Math.random()*Math.PI*2, r = 90 + Math.random()*110;
    s.style.setProperty('--x', `${Math.cos(a)*r}px`); s.style.setProperty('--y', `${Math.sin(a)*r}px`);
    s.style.background = `var(${cols[i%cols.length]})`; s.style.animationDelay = `${Math.random()*.15}s`;
    b.appendChild(s);
  }
  setTimeout(() => b.innerHTML = '', 1500);
}
let tT; function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('show'), 2400); }

/* ---------- Recomendaciones ---------- */
function renderRecs(){
  const list = RECS[S.pid] || [], box = $('#recs'); box.innerHTML = '';
  if (!list.length){ box.innerHTML = `<p class="empty">Todavía no hay recomendaciones para ${pac().nombre.split(' ')[0]}.</p>`; return; }
  list.forEach(r => {
    const d = document.createElement('div'); d.className = 'rec';
    d.innerHTML = `<div class="ic">R</div><div><p></p><small>${esc(r.autor || NUTRI)} · ${fecha(r.f)}</small></div>`;
    d.querySelector('p').textContent = r.txt; box.appendChild(d);
  });
}
function chips(m){
  const s = S.sim, out = [];
  if (m.imc >= 25) out.push('Mantener un déficit moderado de 300 a 500 kcal al día.');
  if (s.grasa > m.fh) out.push('Incluir proteína en cada comida principal.');
  if (s.mus < m.mmin) out.push('Sumar 3 sesiones de fuerza por semana.');
  if (m.imc < 18.5) out.push('Aumentar porciones de carbohidratos complejos.');
  out.push('Tomar 8 vasos de agua al día.');
  if (m.score >= 90) out.push('Mantener el plan actual y revisar en 4 semanas.');
  const c = $('#chips'); c.innerHTML = '';
  out.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = () => { $('#recText').value = t; $('#recText').focus(); }; c.appendChild(b); });
}
$('#btnRec').onclick = async () => {
  const t = $('#recText').value.trim();
  if (!t){ toast('Escribe la recomendación antes de enviarla'); $('#recText').focus(); return; }
  try { const r = await API.addRec(t); (RECS[S.pid] ||= []).unshift({ id:r.id, txt:t, f:TODAY, autor:cfg.userName }); }
  catch (e){ toast('No se envió: ' + e.message); return; }
  $('#recText').value = ''; renderRecs(); toast(`Recomendación enviada a ${pac().nombre}`);
};

/* ---------- Evolución ---------- */
function renderTimeline(){
  const p = pac(), tl = $('#timeline'); tl.innerHTML = '';
  if (p.hist.length < 2){
    $('#btnPlay').hidden = true; $('#chPeso').innerHTML = ''; $('#chComp').innerHTML = '';
    $('#delta').innerHTML = `<p class="empty" style="margin:0">${p.hist.length ? 'Con la próxima medición' : 'Cuando se registren mediciones'} verás aquí cómo cambia el cuerpo.</p>`;
    return;
  }
  $('#btnPlay').hidden = false;
  p.hist.forEach((h,i) => { const b = document.createElement('button'); b.textContent = fecha(h.f); b.setAttribute('aria-current', i === S.idx); b.onclick = () => { stopPlay(); goIdx(i); }; tl.appendChild(b); });
  const a = p.hist[0], z = p.hist.at(-1);
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), Math.abs(v)%1?1:0);
  $('#delta').innerHTML = `<div>Peso <b>${sg(z.peso-a.peso)} kg</b></div><div>Grasa <b>${sg(z.grasa-a.grasa)} pts</b></div><div>Músculo <b>${sg(z.mus-a.mus)} pts</b></div>`;
  chart('#chPeso', [{ k:'peso', col:'--accent' }], 'kg');
  chart('#chComp', [{ k:'grasa', col:'--fat' }, { k:'mus', col:'--muscle' }], '%');
}
function chart(sel, series, unit){
  const p = pac(), W = 340, Hh = 150, L = 34, R = 12, T = 12, B = 26;
  const vals = series.flatMap(s => p.hist.map(h => h[s.k]));
  let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const X = i => L + i * (W - L - R) / (p.hist.length - 1), Y = v => T + (hi - v) / (hi - lo) * (Hh - T - B);
  const ticks = [lo, Math.round((lo+hi)/2), hi];
  let svg = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Gráfica de ${unit}">`;
  ticks.forEach(t => svg += `<line class="gridl" x1="${L}" x2="${W-R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L-6}" y="${Y(t)+3}" text-anchor="end">${t}</text>`);
  p.hist.forEach((h,i) => svg += `<text class="ax" x="${X(i)}" y="${Hh-6}" text-anchor="middle">${fecha(h.f)}</text>`);
  series.forEach(s => {
    svg += `<path d="${p.hist.map((h,i) => `${i?'L':'M'}${X(i)},${Y(h[s.k])}`).join(' ')}" style="stroke:var(${s.col})"/>`;
    p.hist.forEach((h,i) => svg += `<circle cx="${X(i)}" cy="${Y(h[s.k])}" r="${i === S.idx ? 6 : 3}" style="fill:${i === S.idx ? `var(${s.col})` : 'var(--surface)'};stroke:var(${s.col});stroke-width:2"/>`);
    const z = p.hist[S.idx]; svg += `<text class="ax" x="${clamp(X(S.idx), L+14, W-R-14)}" y="${Y(z[s.k])-11}" text-anchor="middle" style="fill:var(--ink);font-weight:500">${fmt(z[s.k], z[s.k]%1?1:0)}</text>`;
  });
  $(sel).innerHTML = svg + '</svg>';
}
function goIdx(i){ S.idx = i; loadSim(i); update(); renderTimeline(); }
function stopPlay(){ clearInterval(S.play); S.play = null; $('#btnPlay').innerHTML = '<i class="bi bi-play-fill me-1"></i>Reproducir evolución'; }
$('#btnPlay').onclick = () => {
  if (S.play){ stopPlay(); return; }
  S.lastLevel = null; goIdx(0); $('#btnPlay').innerHTML = '<i class="bi bi-stop-fill me-1"></i>Detener';
  S.play = setInterval(() => { if (S.idx >= pac().hist.length - 1){ stopPlay(); return; } goIdx(S.idx + 1); }, 1300);
};

/* ---------- Plan ---------- */
// Lista de intercambios. st: pref (resaltado), lim (con moderación), evitar (tachado); vacío = permitido
const INTER = [
  { k:'prot', n:'Carnes', col:'--accent', por:'1 porción = 125 g · 1 libra rinde 5 porciones', rows:[
    { q:'125 g', it:[['Res'],['Cerdo'],['Pollo sin piel'],['Pescado']] }, { q:'1 lata pequeña', it:[['Atún']] } ] },
  { k:'prot', n:'Sustitutos de proteína', col:'--accent', por:'Reemplazan una porción de carne', rows:[
    { q:'1 und', it:[['Huevo','pref']] }, { q:'3 a 4', it:[['Huevos de codorniz','pref']] }, { q:'1 tajada o 2 lonjas', it:[['Queso o cuajada','pref']] },
    { q:'2 lonjas', it:[['Jamón','pref']] }, { q:'1 und', it:[['Salchicha','pref']] } ] },
  { k:'carb', n:'Carbohidratos (harinas)', col:'--warn', por:'1 porción de harina', rows:[
    { q:'1 und mediana', it:[['Arepa delgada'],['Pan de queso'],['Papa común','pref']] }, { q:'1 und', it:[['Tostada'],['Waffle']] }, { q:'1 lonja', it:[['Pan']] },
    { q:'3 und', it:[['Galletas tipo soda'],['Galleta de arroz']] }, { q:'½ mug', it:[['Cereal']] }, { q:'4 cdas', it:[['Avena']] }, { q:'1 paquete', it:[['Rosquillas o chitos']] },
    { q:'2 cucharones', it:[['Sopa o crema','pref'],['Leguminosas']] }, { q:'½ pocillo', it:[['Pasta o quinoa']] }, { q:'4 und medianas', it:[['Papa criolla','pref']] },
    { q:'½ und', it:[['Plátano']] }, { q:'¼ und', it:[['Yuca o batata','pref']] }, { q:'4 cdas soperas', it:[['Arroz o cebada','pref']] } ] },
  { k:'fruta', n:'Frutas', col:'--good', por:'1 porción de fruta', rows:[
    { q:'1 und mediana', it:[['Mango'],['Manzana','pref'],['Pera','pref'],['Zapote'],['Pitaya'],['Níspero'],['Mandarina'],['Naranja']] },
    { q:'2 und medianas', it:[['Ciruela'],['Guayaba'],['Granadilla'],['Murrapo'],['Durazno'],['Kiwi','evitar'],['Curuba'],['Tomate de árbol']] },
    { q:'1 tajada', it:[['Melón'],['Papaya'],['Sandía','pref'],['Piña','pref']] },
    { q:'10 und', it:[['Ciruelas'],['Fresas','pref'],['Moras'],['Uvas'],['Uchuvas'],['Arándanos','pref']] },
    { q:'1 und mediana', it:[['Banano','lim']], note:'1 a 2 veces por semana' }, { q:'1 pocillo', it:[['Guanábana']] } ] },
  { k:'verd', n:'Verduras', col:'--good', por:'1 porción = 1 mug', rows:[
    { q:'1 mug', it:[['Zanahoria'],['Remolacha'],['Ahuyama'],['Vitoria'],['Acelga'],['Champiñones'],['Rábano'],['Habichuela'],['Kale'],['Espárragos'],['Palmitos'],['Cilantro'],['Cidra'],['Tomate'],['Lechuga'],['Apio'],['Berenjena'],['Pepino'],['Cebolla'],['Zuquini'],['Pimentón'],['Brócoli'],['Coliflor'],['Repollo']] } ] },
  { k:'lact', n:'Lácteos', col:'--water', por:'1 porción de lácteo', rows:[
    { q:'1 vaso mediano', it:[['Leche'],['Yogur'],['Kumis']] }, { q:'3 cdas rasas', it:[['Leche en polvo']] }, { q:'1 bola', it:[['Helado dietético']] } ] },
  { k:'grasa', n:'Grasas', col:'--fat', por:'1 porción de grasa', rows:[
    { q:'1 cda dulcera', it:[['Aceite'],['Mantequilla'],['Mayonesa'],['Crema de leche'],['Queso crema']] }, { q:'½ pequeño', it:[['Aguacate']] } ] },
  { k:'secos', n:'Frutos secos', col:'--fat', por:'1 porción', rows:[
    { q:'1 puñado', it:[['Almendras'],['Nueces'],['Macadamias'],['Pistachos']] }, { q:'1 und', it:[['Bebida de frutos secos']] } ] },
  { k:'dulce', n:'Azúcares y dulces', col:'--bad', por:'Solo dentro de la meta de dulce semanal', rows:[
    { q:'2 cdas soperas rasas', it:[['Azúcar']] }, { q:'1 cda sopera rasa', it:[['Mermelada'],['Miel'],['Lecherita'],['Arequipe'],['Panela molida']] }, { q:'1 und pequeña', it:[['Bocadillo']] } ] },
];
// Plantilla para pacientes sin plan: cada componente elige sus alimentos de la lista de intercambios.
const PLAN = [
  { id:'des', ab:'DE', n:'Desayuno', h:'7:30', c:[ ['prot','Proteína','',{ n:2, foods:['Huevo','Queso o cuajada','Jamón'] }], ['carb','Harina','',{ n:1, foods:['Arepa delgada','Pan','Tostada'] }] ] },
  { id:'mm', ab:'MM', n:'Media mañana', c:[ ['','Bebida','Agua'], ['fruta','Fruta','',{ n:1, foods:['Manzana','Pera','Fresas'] }] ] },
  { id:'alm', ab:'AL', n:'Almuerzo', h:'12:30', c:[ ['prot','Proteína','',{ n:1, foods:['Pollo sin piel','Pescado','Res'] }], ['carb','Harina','',{ n:1, foods:['Arroz o cebada','Papa criolla'] }], ['verd','Verduras','',{ n:1, foods:['Brócoli','Zanahoria','Lechuga'] }], ['grasa','Grasa','',{ n:1, foods:['Aceite','Aguacate'] }], ['','Bebida','Agua'] ] },
  { id:'mt', ab:'MT', n:'Media tarde', c:[ ['fruta','Fruta','',{ n:1, foods:[] }], ['secos','Frutos secos','',{ n:1, foods:['Almendras','Nueces'] }] ] },
  { id:'cena', ab:'CE', n:'Cena', h:'19:00', c:[ ['prot','Proteína','',{ n:1, foods:['Pollo sin piel','Huevo','Atún'] }], ['carb','Harina','',{ n:1, foods:['Arepa delgada','Papa común'] }], ['verd','Verduras','Opcional',{ n:1, foods:[] }] ] },
];
const done = new Set(['des','mm']); let agua = 3, aguaU = 'vasos';
const openOpts = new Set();
const META = [ { id:'dulce', n:'Dulce', d:'1 vez por semana, en plan social', max:1, used:0 }, { id:'grasas', n:'Comida grasosa', d:'2 veces al mes', max:2, used:1 } ];
// Cinco estados de la lista de intercambios ('' = permitido).
const ST_ORDER = ['pref', '', 'lim', 'salud', 'evitar'];
const ST_TXT = { pref:'Recomendado', '':'Permitido', lim:'Con moderación', salud:'Limitar por su salud', evitar:'Evitar' };
const ST_RANK = { pref:0, '':1, lim:2, salud:3, evitar:4 };
function chipItem([n, st = ''], gi, ri, ii){
  const fl = foodFlags()[n], tip = `${ST_TXT[st]}${fl ? ' · Para este paciente: ' + fl : ''}`, flag = fl ? '<span class="flag">!</span>' : '';
  if (S.rol !== 'nutri') return `<span class="st ${st}" title="${esc(tip)}">${esc(n)}${flag}</span>`;
  return `<span class="st st-wrap ${st}"><button type="button" class="st-name" data-x="${gi}.${ri}.${ii}" title="${esc(tip)} · toca para cambiar" aria-label="${esc(n)}: ${ST_TXT[st]}. Cambiar estado">${esc(n)}${flag}</button><button type="button" class="st-x" data-xdel="${gi}.${ri}.${ii}" aria-label="Eliminar ${esc(n)}">×</button></span>`;
}
function optionsFor(k){
  const all = [];
  INTER.forEach(g => { if (g.k === k) g.rows.forEach(r => r.it.forEach(it => all.push({ n:it[0], st:it[1] || '', q:r.q }))); });
  return all.sort((a,b) => ST_RANK[a.st] - ST_RANK[b.st]);
}
// Texto de un componente: porciones + alimentos elegidos de la lista de intercambios + detalle libre.
function compText([k, lab, val, sel]){
  const foods = sel?.foods || [], n = sel?.n;
  const por = n ? `${fmt(n, n % 1 ? 1 : 0)} ${n == 1 ? 'porción' : 'porciones'}` : '';
  const main = por && foods.length ? `${por}: ${foods.join(', ')}` : foods.length ? foods.join(', ') : por;
  return [main, val].filter(Boolean).join(' · ') || '—';
}
function renderPlan(){
  persistAll();
  const box = $('#meals'); box.innerHTML = '';
  const ed = editPlan && S.rol === 'nutri';
  $('#btnEditPlan').textContent = ed ? 'Listo' : 'Editar plan'; $('#editHint').hidden = !ed; $('#ehName').textContent = pac().nombre;
  $('#aguaMetaBox').hidden = !ed; $('#aguaMetaSel').value = String(aguaMeta);
  if (ed) renderPlanEdit(box);
  else PLAN.forEach(m => {
    const d = document.createElement('div'); d.className = 'meal' + (done.has(m.id) ? ' done' : '');
    d.innerHTML = `<div class="meal-head"><div class="tag">${esc(m.ab)}</div><div class="grow"><h4>${esc(m.n)}</h4><small>${esc([m.h, m.note].filter(Boolean).join(' · ') || 'Sin hora fija')}</small></div>
      <button class="check" aria-pressed="${done.has(m.id)}" aria-label="Marcar ${m.n} como cumplido">✓</button></div>` +
      m.c.map(([k, lab, val, sel], ci) => {
        const key = `${m.id}.${ci}`, op = openOpts.has(key);
        const opts = k && op ? `<div class="opts">${optionsFor(k).filter(o => o.st !== 'evitar').map(o => { const fl = foodFlags()[o.n]; return `<span class="st ${o.st}" title="${o.q}${fl ? ' · ' + fl : ''}">${o.n}${fl ? '<span class="flag">!</span>' : ''}</span>`; }).join('')}</div>` : '';
        return `<div class="comp"><div class="lab ${k}">${esc(lab)}</div><div><div class="val"></div>${k ? `<button class="opts-btn" data-o="${key}">${op ? 'Ocultar intercambios' : 'Ver intercambios'}</button>` : ''}${opts}</div></div>`;
      }).join('');
    m.c.forEach((c, ci) => d.querySelectorAll('.val')[ci].textContent = compText(c));
    d.querySelector('.check').onclick = () => { done.has(m.id) ? done.delete(m.id) : done.add(m.id); renderPlan(); if (done.size === PLAN.length) { burst(); toast('Cumpliste todos los tiempos de comida de hoy'); } };
    d.querySelectorAll('.opts-btn').forEach(b => b.onclick = () => { const k = b.dataset.o; openOpts.has(k) ? openOpts.delete(k) : openOpts.add(k); renderPlan(); });
    box.appendChild(d);
  });
  $('#progTxt').textContent = `${done.size} de ${PLAN.length} tiempos`;
  requestAnimationFrame(() => $('#progBar').style.width = `${done.size / PLAN.length * 100}%`);
  // metas
  if (ed) renderGoalsEdit(); else {
  $('#goals').innerHTML = META.map(g => `<div class="goal"><b>${esc(g.n)}</b><small>${esc(g.d)}</small><div class="pips">${Array.from({length:g.max}, (_,i) => `<button class="pip ${i < g.used ? 'on' : ''}" data-g="${g.id}" data-i="${i}" aria-label="${g.n}: registro ${i+1}"></button>`).join('')}<small style="align-self:center;margin-left:4px">${g.used} de ${g.max} usados</small></div></div>`).join('');
  $$('#goals .pip').forEach(p => p.onclick = () => { const g = META.find(x => x.id === p.dataset.g), i = Number(p.dataset.i); g.used = i < g.used ? i : i + 1; renderPlan(); }); }
  // agua
  const g = $('#glasses'); g.innerHTML = '';
  const nv = Math.round(aguaMeta / .25);
  for (let i = 0; i < nv; i++){ const b = document.createElement('button'); b.className = 'glass' + (i < agua ? ' full' : ''); b.setAttribute('aria-label', `Vaso ${i+1}`); b.onclick = () => { agua = i < agua ? i : i + 1; renderPlan(); }; g.appendChild(b); }
  const L = aguaU === 'L', litros = agua * .25;
  $('#glasses').hidden = L; $('#bottle').hidden = !L; $('#wBtns').hidden = !L;
  $('#uVasos').setAttribute('aria-pressed', !L); $('#uLitros').setAttribute('aria-pressed', L);
  $('#aguaTxt').textContent = L ? `${fmt(litros, litros % 1 ? 2 : 0)} de ${fmt(aguaMeta, aguaMeta % 1 ? 1 : 0)} litros` : `${agua} de ${nv} vasos`;
  $('#aguaSub').textContent = L ? `${(agua * 250).toLocaleString('es-CO')} ml tomados · faltan ${fmt(Math.max(0, aguaMeta - litros), 2)} L` : `1 vaso = 250 ml · meta ${fmt(aguaMeta, aguaMeta % 1 ? 1 : 0)} litros al día`;
  $('#bmarks').innerHTML = [1, .75, .5, .25].map(f => `<span>${fmt(aguaMeta * f, (aguaMeta * f) % 1 ? 2 : 0)}${f === 1 ? ' L' : ''}</span>`).join('');
  requestAnimationFrame(() => $('#bfill').style.height = `${Math.min(agua / nv, 1) * 100}%`);
  // intercambios
  const nut = S.rol === 'nutri';
  $('#interHint').textContent = nut ? 'Toca un alimento para elegir su estado o la × para quitarlo. Los tiempos de comida eligen sus alimentos de esta lista.' : 'Cada alimento equivale a 1 porción en la cantidad indicada. Prefiere los resaltados.';
  $('#xgroups').innerHTML = INTER.map((g,gi) => `<div class="xg"><h4><i style="background:var(${g.col})"></i>${g.n}</h4><div class="por">${g.por}</div>` +
    g.rows.map((r,ri) => `<div class="xrow">${r.it.map((it,ii) => chipItem(it, gi, ri, ii)).join('')}<span class="q">${esc(r.q)}</span>${r.note ? `<span class="xnote">${esc(r.note)}</span>` : ''}</div>`).join('') +
    (nut ? `<div class="xadd"><input class="tin" data-xg="${gi}" placeholder="Nuevo alimento" aria-label="Nuevo alimento para ${g.n}"><input class="tin" data-xq="${gi}" placeholder="Porción, ej. 1 und" aria-label="Porción" style="max-width:150px"><button class="btn btn-outline-secondary btn-sm" data-xadd="${gi}"><i class="bi bi-plus-lg me-1"></i>Agregar</button></div>` : '') + `</div>`).join('');
  $$('#xgroups [data-xadd]').forEach(b => b.onclick = () => {
    const gi = Number(b.dataset.xadd), n = $(`[data-xg="${gi}"]`).value.trim(), q = $(`[data-xq="${gi}"]`).value.trim() || '1 porción';
    if (!n){ toast('Escribe el nombre del alimento'); return; }
    const g = INTER[gi]; let row = g.rows.find(r => r.q.toLowerCase() === q.toLowerCase());
    if (!row){ row = { q, it:[] }; g.rows.push(row); }
    row.it.push([n, '']); renderPlan(); toast(`${n} agregado a ${g.n}`);
  });
  $$('#xgroups [data-x]').forEach(b => b.onclick = e => { e.stopPropagation(); openStateMenu(b, ...b.dataset.x.split('.').map(Number)); });
  $$('#xgroups [data-xdel]').forEach(b => b.onclick = () => {
    const [gi, ri, ii] = b.dataset.xdel.split('.').map(Number), row = INTER[gi].rows[ri], [name] = row.it[ii];
    row.it.splice(ii, 1); if (!row.it.length) INTER[gi].rows.splice(ri, 1);
    // Sincronía: el alimento también sale de los tiempos de comida que lo tenían elegido.
    PLAN.forEach(m => m.c.forEach(c => { if (c[3]?.foods) c[3].foods = c[3].foods.filter(f => f !== name); }));
    renderPlan(); toast(`${name} quitado de la lista`);
  });
}

$('#uVasos').onclick = () => { aguaU = 'vasos'; renderPlan(); };
$('#uLitros').onclick = () => { aguaU = 'L'; renderPlan(); };
$('#wPlus').onclick = () => { agua = Math.min(Math.round(aguaMeta / .25) + 4, agua + 1); renderPlan(); if (agua === Math.round(aguaMeta / .25)) toast('Meta de agua cumplida'); };
$('#aguaMetaSel').onchange = e => { aguaMeta = Number(e.target.value); renderPlan(); };
$('#btnEditPlan').hidden = true;  // edición directa: no hay modo "editar plan"
$('#btnEditPlan').onclick = () => { editPlan = !editPlan; renderPlan(); if (!editPlan) toast(`Plan actualizado para ${pac().nombre}`); };
$('#wMinus').onclick = () => { agua = Math.max(0, agua - 1); renderPlan(); };
/* ---------- Edición del plan (solo nutricionista) ---------- */
let editPlan = cfg.mode === 'nutri', aguaMeta = 2;  // el profesional edita el plan directamente
// Plan guardado del paciente; si no hay, se usa la plantilla de arriba.
if (D.plan){
  if (Array.isArray(D.plan.meals)) PLAN.splice(0, PLAN.length, ...D.plan.meals);
  if (Array.isArray(D.plan.goals)) META.splice(0, META.length, ...D.plan.goals.map(g => ({ ...g, used:0 })));
  if (Array.isArray(D.plan.inter)) INTER.splice(0, INTER.length, ...D.plan.inter);
  if (D.plan.agua) aguaMeta = D.plan.agua;
}
{ const used = D.tracking?.goalsUsed || {}; META.forEach(g => g.used = Math.min(used[g.id] || 0, g.max)); }
done.clear(); (D.log?.done || []).forEach(id => done.add(id)); agua = D.log?.agua || 0;
const planDoc = () => ({ meals:PLAN, goals:META.map(({ used, ...g }) => g), inter:INTER, agua:aguaMeta });
const trackDoc = () => ({ goalsUsed:Object.fromEntries(META.map(g => [g.id, g.used])) });
const logDoc = () => ({ done:[...done], agua });
const CTYPES = [['prot','Proteína'],['carb','Harina'],['fruta','Fruta'],['verd','Verduras'],['grasa','Grasa'],['lact','Lácteo'],['secos','Frutos secos'],['','Bebida'],['','Opcional'],['','Más uno de'],['','Otro']];
const abbr = n => { const w = n.trim().split(/\s+/).filter(Boolean); return ((w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '··').slice(0, 2))).toUpperCase(); };
const to24 = h => { if (!h) return ''; const [a,b] = h.split(':'); return `${String(a).padStart(2,'0')}:${b || '00'}`; };
const from24 = v => { if (!v) return ''; const [a,b] = v.split(':'); return `${Number(a)}:${b}`; };
function renderPlanEdit(box){
  PLAN.forEach((m, mi) => {
    const d = document.createElement('div'); d.className = 'meal editing';
    d.innerHTML = `<div class="meal-head"><div class="tag">${esc(m.ab || abbr(m.n))}</div><div class="grow"><h4>${esc(m.n)}</h4><small>${esc([m.h, m.note].filter(Boolean).join(' · ') || 'Sin hora fija')}</small></div>
        <div class="mtools">
          <button class="btn btn-outline-secondary btn-sm" data-mv="-1" ${mi === 0 ? 'disabled' : ''} aria-label="Subir"><i class="bi bi-arrow-up"></i></button>
          <button class="btn btn-outline-secondary btn-sm" data-mv="1" ${mi === PLAN.length - 1 ? 'disabled' : ''} aria-label="Bajar"><i class="bi bi-arrow-down"></i></button>
          <button class="btn btn-primary btn-sm" data-edit><i class="bi bi-pencil me-1"></i>Editar</button>
          <button class="btn btn-outline-danger btn-sm" data-delm aria-label="Eliminar ${esc(m.n)}"><i class="bi bi-trash"></i></button>
        </div></div>` +
      (m.c.length ? m.c.map(c => `<div class="comp"><div class="lab ${c[0]}">${esc(c[1])}</div><div class="val">${esc(compText(c))}</div></div>`).join('')
        : '<p class="empty" style="margin-top:10px">Aún no tiene componentes. Toca Editar.</p>');
    d.querySelector('[data-edit]').onclick = () => openMealModal(mi);
    d.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const j = mi + Number(b.dataset.mv); [PLAN[mi], PLAN[j]] = [PLAN[j], PLAN[mi]]; renderPlan(); });
    d.querySelector('[data-delm]').onclick = () => {
      if (!confirm(`¿Eliminar ${m.n} del plan?`)) return;
      PLAN.splice(mi, 1); done.delete(m.id); renderPlan(); toast(`${m.n} eliminado del plan`);
    };
    box.appendChild(d);
  });
  const add = document.createElement('button'); add.className = 'addmeal'; add.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Agregar tiempo de comida';
  add.onclick = () => { PLAN.push({ id:'m' + Date.now(), n:'Nuevo tiempo', ab:'NT', h:'', c:[['prot', 'Proteína', '', { n:1, foods:[] }]] }); openMealModal(PLAN.length - 1, true); };
  box.appendChild(add);
}

// ---------- modal para editar un tiempo de comida ----------
function compEditor(c, i){
  const [k, lab, val, sel] = c, opts = k ? optionsFor(k) : [], flags = foodFlags();
  return `<div class="mc-comp" data-i="${i}">
    <div class="mc-row">
      <label class="mc-f"><span>Tipo</span><select class="form-select form-select-sm" data-c="lab">${CTYPES.map(([, l]) => `<option ${l === lab ? 'selected' : ''}>${l}</option>`).join('')}${CTYPES.some(t => t[1] === lab) ? '' : `<option selected>${esc(lab)}</option>`}</select></label>
      ${k ? `<label class="mc-f mc-n"><span>Porciones</span><input type="number" min="0" max="20" step="0.5" class="form-control form-control-sm" data-c="n" value="${sel?.n ?? ''}"></label>` : ''}
      <button type="button" class="btn btn-sm btn-outline-danger mc-del" data-del aria-label="Quitar componente"><i class="bi bi-x-lg"></i></button>
    </div>
    ${k ? `<div class="mc-hint">Elige de la lista de intercambios${opts.length ? '' : ' (este grupo no tiene alimentos)'}:</div>
      <div class="mc-foods">${opts.map(o => `<button type="button" class="st ${o.st} ${sel?.foods?.includes(o.n) ? 'picked' : ''}" data-food="${esc(o.n)}" ${o.st === 'evitar' ? 'disabled title="Marcado como Evitar"' : `title="${esc(o.q)}"`}>${esc(o.n)}${flags[o.n] ? '<span class="flag">!</span>' : ''}</button>`).join('')}</div>` : ''}
    <input class="form-control form-control-sm mt-2" data-c="val" value="${esc(val || '')}" placeholder="${k ? 'Detalle opcional, ej. a la plancha' : 'Ej. agua, gelatina o limonada'}">
  </div>`;
}
function openMealModal(mi, isNew = false){
  const draft = JSON.parse(JSON.stringify(PLAN[mi]));
  let dlg = $('#mealDlg');
  if (!dlg){ dlg = document.createElement('dialog'); dlg.id = 'mealDlg'; dlg.className = 'cv-modal'; document.body.appendChild(dlg); }
  dlg.innerHTML = `<form method="dialog" class="cv-modal-box">
      <div class="cv-modal-head"><h3>${isNew ? 'Nuevo tiempo de comida' : 'Editar tiempo de comida'}</h3><button type="button" class="btn-close" data-close aria-label="Cerrar"></button></div>
      <div class="cv-modal-body">
        <div class="mc-row">
          <label class="mc-f" style="flex:2"><span>Nombre</span><input class="form-control" data-m="n" value="${esc(draft.n)}" required maxlength="40"></label>
          <label class="mc-f" style="max-width:130px"><span>Hora</span><input class="form-control" type="time" data-m="h" value="${to24(draft.h)}"></label>
        </div>
        <label class="mc-f"><span>Nota</span><input class="form-control" data-m="note" value="${esc(draft.note || '')}" placeholder="Ej. pre-entreno" maxlength="60"></label>
        <div class="mc-title">Lo que lleva</div>
        <div id="mcComps" class="d-flex flex-column gap-2"></div>
        <button type="button" class="btn btn-outline-secondary btn-sm align-self-start" data-add><i class="bi bi-plus-lg me-1"></i>Agregar componente</button>
      </div>
      <div class="cv-modal-foot"><button type="button" class="btn btn-outline-secondary" data-close>Cancelar</button><button type="submit" value="ok" class="btn btn-primary"><i class="bi bi-check2 me-1"></i>Guardar</button></div>
    </form>`;
  const comps = () => { dlg.querySelector('#mcComps').innerHTML = draft.c.map(compEditor).join('') || '<p class="empty">Agrega lo que lleva esta comida.</p>'; };
  comps();
  const compOf = el => draft.c[Number(el.closest('.mc-comp')?.dataset.i)];
  dlg.oninput = e => {
    const t = e.target;
    if (t.dataset.m) draft[t.dataset.m] = t.dataset.m === 'h' ? from24(t.value) : t.value;
    else if (t.dataset.c === 'n'){ const c = compOf(t); c[3] = { ...(c[3] || { foods:[] }), n:t.value === '' ? null : clamp(Number(t.value), 0, 20) }; }
    else if (t.dataset.c === 'val') compOf(t)[2] = t.value;
  };
  dlg.onchange = e => {
    if (e.target.dataset.c !== 'lab') return;
    const c = compOf(e.target), k = (CTYPES.find(t => t[1] === e.target.value) || [''])[0];
    c[1] = e.target.value;
    if (k !== c[0]){ c[0] = k; c[3] = k ? { n:c[3]?.n ?? 1, foods:[] } : undefined; comps(); }
  };
  dlg.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close !== undefined) dlg.close('cancel');
    else if (t.dataset.food !== undefined){
      const c = compOf(t); c[3] = c[3] || { n:1, foods:[] };
      const f = c[3].foods, name = t.dataset.food, i = f.indexOf(name);
      i >= 0 ? f.splice(i, 1) : f.push(name); t.classList.toggle('picked', i < 0);
    } else if (t.dataset.del !== undefined){ draft.c.splice(Number(t.closest('.mc-comp').dataset.i), 1); comps(); }
    else if (t.dataset.add !== undefined){ draft.c.push(['prot', 'Proteína', '', { n:1, foods:[] }]); comps(); dlg.querySelector('.cv-modal-body').scrollTo({ top:1e6, behavior:'smooth' }); }
  };
  dlg.onclose = () => {
    if (dlg.returnValue === 'ok'){
      draft.n = (draft.n || '').trim() || 'Tiempo de comida'; draft.ab = abbr(draft.n);
      draft.c = draft.c.filter(c => c[0] || c[2]);  // sin tipo de intercambio ni detalle, no aporta
      PLAN[mi] = draft; renderPlan(); toast(`${draft.n} guardado`);
    } else if (isNew){ PLAN.splice(mi, 1); renderPlan(); }
  };
  dlg.returnValue = '';
  dlg.showModal();
}

// ---------- menú de estado de un alimento (lista de intercambios) ----------
let stMenu = null;
function closeStateMenu(){ stMenu?.remove(); stMenu = null; document.removeEventListener('click', outsideStateMenu); }
function outsideStateMenu(e){ if (stMenu && !stMenu.contains(e.target)) closeStateMenu(); }
function openStateMenu(btn, gi, ri, ii){
  closeStateMenu();
  const it = INTER[gi].rows[ri].it[ii], cur = it[1] || '';
  stMenu = document.createElement('div'); stMenu.className = 'st-menu'; stMenu.setAttribute('role', 'menu');
  stMenu.innerHTML = `<div class="st-menu-title">${esc(it[0])}</div>` + ST_ORDER.map(k =>
    `<button type="button" role="menuitemradio" aria-checked="${cur === k}" data-st="${k}"><span class="st ${k}">${ST_TXT[k]}</span>${cur === k ? '<i class="bi bi-check2"></i>' : ''}</button>`).join('');
  document.body.appendChild(stMenu);
  const r = btn.getBoundingClientRect(), w = stMenu.offsetWidth || 230;
  stMenu.style.top = `${r.bottom + window.scrollY + 6}px`;
  stMenu.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - w - 8))}px`;
  stMenu.onclick = e => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    it[1] = b.dataset.st; closeStateMenu(); renderPlan(); toast(`${it[0]}: ${ST_TXT[it[1]]}`);
  };
  setTimeout(() => document.addEventListener('click', outsideStateMenu));
}

function renderGoalsEdit(){
  $('#goals').innerHTML = META.map((g,i) => `<div class="goal editing"><label class="ef"><span>Meta</span><input class="tin" data-gi="${i}" data-f="n" value="${esc(g.n)}"></label>
      <label class="ef"><span>Frecuencia</span><input class="tin" data-gi="${i}" data-f="d" value="${esc(g.d)}"></label>
      <div class="cv-row" style="gap:8px;margin-top:6px"><label class="ef" style="max-width:110px"><span>Veces</span><input class="tin" type="number" min="1" max="10" data-gi="${i}" data-f="max" value="${g.max}"></label><button class="btn btn-outline-danger btn-sm" data-delg="${i}" style="align-self:flex-end">Quitar</button></div></div>`).join('') +
    `<button class="addmeal" id="addGoal" style="min-height:100px">+ Agregar meta</button>`;
  $$('#goals [data-gi]').forEach(i => i.addEventListener('input', () => { const g = META[Number(i.dataset.gi)], f = i.dataset.f; g[f] = f === 'max' ? clamp(parseInt(i.value) || 1, 1, 10) : i.value; g.used = Math.min(g.used, g.max); }));
  $$('#goals [data-delg]').forEach(b => b.onclick = () => { META.splice(Number(b.dataset.delg), 1); renderPlan(); });
  $('#addGoal').onclick = () => { META.push({ id:'g' + Date.now(), n:'Nueva meta', d:'1 vez por semana', max:1, used:0 }); renderPlan(); };
}

/* ---------- Medidas ---------- */
const CAMPOS = [
  { g:'Composición corporal', sub:'Báscula de bioimpedancia', f:[['peso','Peso','kg',.1],['talla','Estatura','cm',1],['grasa','Grasa corporal','%',.1],['mus','Músculo esquelético','%',.1],['visceral','Grasa visceral','nivel',1],['agua','Agua corporal','%',.1],['osea','Masa ósea','kg',.1],['edadMet','Edad metabólica','años',1]] },
  { g:'Circunferencias', sub:'Cinta métrica', f:[['cuello','Cuello','cm',.5],['pecho','Pecho','cm',.5],['brazoR','Brazo relajado','cm',.5],['brazoC','Brazo contraído','cm',.5],['cintura','Cintura','cm',.5],['abdomen','Abdomen','cm',.5],['cadera','Cadera','cm',.5],['muslo','Muslo','cm',.5],['pantorrilla','Pantorrilla','cm',.5],['muneca','Muñeca','cm',.5]] },
  { g:'Pliegues cutáneos', sub:'Plicómetro', f:[['pTri','Tricipital','mm',1],['pBi','Bicipital','mm',1],['pSub','Subescapular','mm',1],['pSupra','Suprailíaco','mm',1],['pAbd','Abdominal','mm',1],['pMuslo','Muslo','mm',1],['pPant','Pantorrilla','mm',1]] },
  { g:'Diámetros óseos y longitudes', sub:'Paquímetro y antropómetro', f:[['hum','Húmero (biepicondilar)','cm',.1],['fem','Fémur (bicondilar)','cm',.1],['bies','Muñeca (biestiloideo)','cm',.1],['sentado','Talla sentado','cm',.5],['env','Envergadura','cm',.5]] },
  { g:'Signos vitales', sub:'Tensiómetro y glucómetro', f:[['pas','Presión sistólica','mmHg',1],['pad','Presión diastólica','mmHg',1],['fc','Frecuencia cardíaca','lpm',1],['glu','Glucosa en ayunas','mg/dL',1]] },
];
const SIMK = ['peso','talla','grasa','mus'];
const VITK = ['pas','pad','fc','glu'];
// medidas conocidas + estimadas pendientes (las medidas reales siempre ganan)
const medAll = () => ({ ...(S.est || {}), ...S.med });
const getV = k => SIMK.includes(k) ? S.sim[k] : medAll()[k];
const n1 = v => fmt(v, v % 1 ? 1 : 0);
const r05 = v => Math.round(v * 2) / 2, r1 = v => Math.round(v * 10) / 10, r0 = v => Math.round(v);
/* Técnica de estimación: proporciones antropométricas y ecuaciones inversas a partir de lo que ya se midió.
   Orden: perímetros del tronco → perímetros de extremidades → composición → pliegues → diámetros y longitudes. */
function estimar(){
  const s = S.sim, p = pac(), M = s.sexo === 'M', E = {}, rej = S.rej || new Set();
  const imc = s.peso / Math.pow(s.talla/100, 2), edad = p.edad, G = s.grasa, mus = s.mus;
  const g = k => S.med[k] ?? E[k];
  const put = (k, fn) => { if (S.med[k] == null && !rej.has(k)) { const v = fn(); if (Number.isFinite(v) && v > 0) E[k] = v; } };
  put('cintura', () => r05(M ? 30 + 2.3*imc + .12*edad : 20 + 2.3*imc + .1*edad));
  put('cadera', () => r05(g('cintura') ? (M ? g('cintura') * 1.02 + 2 : g('cintura') * .95 + 26) : (M ? 40 + 2.2*imc : 52 + 2.15*imc)));
  put('abdomen', () => r05(g('cintura') * 1.06));
  put('cuello', () => r05(M ? 22 + .68*imc : 20 + .5*imc));
  put('pecho', () => r05(g('cintura') ? g('cintura') + (M ? 8 : 10) : (M ? 50 + 2*imc : 46 + 1.8*imc)));
  put('brazoR', () => r05(M ? .9*imc + 6 : .95*imc + 5.5));
  put('brazoC', () => r05(g('brazoR') + (M ? 2.2 : 1.4) * (mus / 30)));
  put('muslo', () => r05(M ? .32*g('cadera') + 25 : .45*g('cadera') + 11));
  put('pantorrilla', () => r05(.34*g('cadera') + 2));
  put('muneca', () => r05(s.talla * (M ? .1 : .093)));
  put('visceral', () => clamp(r0(M ? (g('cintura') - 80)/2 + edad/15 : (g('cintura') - 70)/2.2 + edad/20), 1, 30));
  put('agua', () => r1((100 - G) * .73));
  put('osea', () => r1(s.peso * (1 - G/100) * .05));
  put('edadMet', () => r0(edad + (G - (M ? 18 : 25)) * .8));
  // pliegues: Durnin-Womersley al revés desde el % de grasa, repartidos por proporciones típicas y ajustados a los pliegues ya medidos
  const T = M ? [[29,1.1631,.0632],[39,1.1422,.0544],[49,1.1620,.0700],[200,1.1715,.0779]] : [[29,1.1599,.0717],[39,1.1423,.0632],[49,1.1333,.0612],[200,1.1339,.0645]];
  const [, c, m] = T.find(r => edad <= r[0]);
  const sum4 = Math.pow(10, (c - 495/(G + 450)) / m);
  const base = { pTri:sum4*.27, pBi:sum4*.13, pSub:sum4*.30, pSupra:sum4*.30 };
  base.pAbd = base.pSupra * 1.25; base.pMuslo = base.pTri * (M ? 1.15 : 1.35); base.pPant = base.pTri * .7;
  const meas = Object.keys(base).filter(k => S.med[k] != null);
  const f = meas.length ? meas.reduce((a,k) => a + S.med[k], 0) / meas.reduce((a,k) => a + base[k], 0) : 1;
  Object.keys(base).forEach(k => put(k, () => r0(base[k] * f)));
  put('hum', () => r1(s.talla * (M ? .041 : .0375)));
  put('fem', () => r1(s.talla * (M ? .058 : .055)));
  put('bies', () => r1(g('muneca') * .33));
  put('sentado', () => r05(s.talla * .52));
  put('env', () => r05(s.talla * (M ? 1.03 : 1)));
  S.est = E;
}
function calcs(gi){
  const s = S.sim, d = medAll(), p = pac(), M = s.sexo === 'M', m = metr(s);
  if (gi === 0){
    const mg = s.peso * s.grasa / 100;
    const tmb = 10*s.peso + 6.25*s.talla - 5*p.edad + (M ? 5 : -161);
    const vis = d.visceral <= 9 ? ['Normal','--good'] : d.visceral <= 14 ? ['Alta','--warn'] : ['Muy alta','--bad'];
    const em = d.edadMet <= p.edad ? ['Igual o menor a su edad','--good'] : ['Mayor a su edad','--warn'];
    return [['IMC', fmt(m.imc), m.imcCat], ['Masa grasa', `${fmt(mg)} kg`], ['Masa libre de grasa', `${fmt(s.peso - mg)} kg`], ['Metabolismo basal', `${Math.round(tmb).toLocaleString('es-CO')} kcal`], ['Grasa visceral', `Nivel ${d.visceral}`, vis], ['Edad metabólica', `${d.edadMet} años`, em]];
  }
  if (gi === 1){
    const icc = d.cintura / d.cadera, lim = M ? .9 : .85;
    const ict = d.cintura / s.talla;
    const r = s.talla / d.muneca;
    const comp = M ? (r > 10.4 ? 'Pequeña' : r >= 9.6 ? 'Mediana' : 'Grande') : (r > 11 ? 'Pequeña' : r >= 10.1 ? 'Mediana' : 'Grande');
    return [['Índice cintura-cadera', fmt(icc, 2), icc < lim - .05 ? ['Riesgo bajo','--good'] : icc < lim ? ['Riesgo moderado','--warn'] : ['Riesgo alto','--bad']],
            ['Índice cintura-estatura', fmt(ict, 2), ict < .5 ? ['Saludable','--good'] : ict < .6 ? ['Riesgo aumentado','--warn'] : ['Riesgo alto','--bad']],
            ['Complexión', comp, [`Estatura / muñeca ${fmt(r)}`,'--accent']],
            ['Músculo del brazo', `+${n1(d.brazoC - d.brazoR)} cm`, ['Contraído menos relajado','--accent']]];
  }
  if (gi === 2){
    const sum = ['pTri','pBi','pSub','pSupra','pAbd','pMuslo','pPant'].reduce((a,k) => a + d[k], 0);
    const tronco = d.pSub + d.pSupra + d.pAbd, ext = d.pTri + d.pBi + d.pMuslo + d.pPant;
    return [['Suma de 7 pliegues', `${n1(sum)} mm`], ['Tronco', `${n1(tronco)} mm`], ['Extremidades', `${n1(ext)} mm`], ['Distribución', tronco > ext ? 'Central' : 'Periférica', tronco > ext ? ['Más grasa en el tronco','--warn'] : ['Más grasa en extremidades','--good']]];
  }
  if (gi === 3){
    const st = somato(), idx = s.talla ? d.sentado / s.talla * 100 : 0;
    const pg = dw();
    const amb = Math.pow(d.brazoR - Math.PI * d.pTri/10, 2) / (4*Math.PI) - (M ? 10 : 6.5);
    const cormico = idx < 51 ? 'Tronco corto' : idx <= 53 ? 'Tronco medio' : 'Tronco largo';
    return [['Somatotipo', `${fmt(st.endo)} – ${fmt(st.meso)} – ${fmt(st.ecto)}`, [st.tipo,'--accent']],
            ['% grasa por pliegues', `${fmt(pg)} %`, [`Durnin-Womersley · báscula ${n1(s.grasa)} %`,'--accent']],
            ['Área muscular del brazo', `${fmt(amb)} cm²`],
            ['Índice córmico', fmt(idx), [cormico,'--accent']],
            ['Envergadura − talla', `${d.env - s.talla > 0 ? '+' : ''}${n1(d.env - s.talla)} cm`]];
  }
  const pa = d.pas >= 140 || d.pad >= 90 ? ['Hipertensión grado 2','--bad'] : d.pas >= 130 || d.pad >= 80 ? ['Hipertensión grado 1','--warn'] : d.pas >= 120 ? ['Elevada','--warn'] : ['Normal','--good'];
  const gl = d.glu < 100 ? ['Normal','--good'] : d.glu < 126 ? ['Alterada','--warn'] : ['Alta','--bad'];
  const fc = d.fc >= 60 && d.fc <= 100 ? ['En reposo normal','--good'] : ['Fuera de rango','--warn'];
  return [['Presión arterial', `${d.pas}/${d.pad}`, pa], ['Frecuencia cardíaca', `${d.fc} lpm`, fc], ['Glucosa', `${d.glu} mg/dL`, gl]];
}
function somato(){
  const s = S.sim, d = medAll();
  const X = (d.pTri + d.pSub + d.pSupra) * (170.18 / s.talla);
  const endo = -0.7182 + 0.1451*X - 0.00068*X*X + 0.0000014*X*X*X;
  const meso = 0.858*d.hum + 0.601*d.fem + 0.188*(d.brazoC - d.pTri/10) + 0.161*(d.pantorrilla - d.pPant/10) - 0.131*s.talla + 4.5;
  const hwr = s.talla / Math.cbrt(s.peso);
  const ecto = hwr >= 40.75 ? 0.732*hwr - 28.58 : hwr > 38.25 ? 0.463*hwr - 17.63 : 0.1;
  const v = { endo:Math.max(endo,.1), meso:Math.max(meso,.1), ecto:Math.max(ecto,.1) };
  const top = Object.entries(v).sort((a,b) => b[1]-a[1]);
  const nom = { endo:'endomorfo', meso:'mesomorfo', ecto:'ectomorfo' };
  v.tipo = top[0][1] - top[1][1] < .5 ? `${nom[top[0][0]].replace('o','o')}-${nom[top[1][0]]}`.replace(/^./, c => c.toUpperCase()) : nom[top[0][0]].replace(/^./, c => c.toUpperCase()) + ' dominante';
  v.x = v.ecto - v.endo; v.y = 2*v.meso - (v.endo + v.ecto);
  return v;
}
function dw(){
  const s = S.sim, d = medAll(), e = pac().edad, M = s.sexo === 'M';
  const T = M ? [[29,1.1631,.0632],[39,1.1422,.0544],[49,1.1620,.0700],[200,1.1715,.0779]] : [[29,1.1599,.0717],[39,1.1423,.0632],[49,1.1333,.0612],[200,1.1339,.0645]];
  const [, c, m] = T.find(r => e <= r[0]);
  const D = c - m * Math.log10(d.pTri + d.pBi + d.pSub + d.pSupra);
  return 495 / D - 450;
}
function somatoChart(){
  const st = somato(), W = 300, H = 250, cx = 150, cy = 150;
  const X = x => cx + x * 15, Y = y => cy - y * 8.5;
  const P = [[X(0),Y(12)],[X(-6),Y(-6)],[X(6),Y(-6)]];
  const arc = (a,b) => `Q${(a[0]+b[0])/2 + (a[0]+b[0])/2 - cx > 0 ? 18 : -18},${(a[1]+b[1])/2}`;
  const tri = `M${P[0]} Q${X(-5.2)},${Y(5)} ${P[1]} Q${X(0)},${Y(-8.6)} ${P[2]} Q${X(5.2)},${Y(5)} ${P[0]} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Somatocarta" style="width:100%;max-width:340px;display:block;margin:12px auto 0">
    <path d="${tri}" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1.5"/>
    <line x1="${X(0)}" y1="${Y(12)}" x2="${X(0)}" y2="${Y(-2)}" stroke="var(--line)"/>
    <line x1="${X(-6)}" y1="${Y(-6)}" x2="${X(0)}" y2="${Y(-2)}" stroke="var(--line)"/>
    <line x1="${X(6)}" y1="${Y(-6)}" x2="${X(0)}" y2="${Y(-2)}" stroke="var(--line)"/>
    <text x="${X(0)}" y="${Y(12)-8}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--muscle)">Mesomorfo</text>
    <text x="${X(-6)-4}" y="${Y(-6)+18}" text-anchor="start" font-size="12" font-weight="700" fill="var(--fat)">Endomorfo</text>
    <text x="${X(6)+4}" y="${Y(-6)+18}" text-anchor="end" font-size="12" font-weight="700" fill="var(--water)">Ectomorfo</text>
    <circle cx="${X(clamp(st.x,-8,8))}" cy="${Y(clamp(st.y,-9,14))}" r="12" fill="var(--accent)" opacity=".18"><animate attributeName="r" values="9;15;9" dur="2s" repeatCount="indefinite"/></circle>
    <circle cx="${X(clamp(st.x,-8,8))}" cy="${Y(clamp(st.y,-9,14))}" r="6" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
  </svg><p class="empty" style="text-align:center;margin:4px 0 0;font-size:12.5px">Somatocarta de Heath-Carter. El punto muestra la forma corporal del paciente.</p>`;
}
function renderMedidas(){
  const ro = S.rol !== 'nutri', h = pac().hist.at(-1);
  const P = pac(), last = P.mediciones.at(-1);
  $('#medInfo').innerHTML = S.isDraft
    ? `<b class="draftword">Medición nueva del ${fecha(TODAY)}, en curso.</b> Lo que llenes se conserva hasta que la guardes; al lado de cada campo ves el valor anterior.`
    : (last ? `Tomadas el ${fecha(last.f)}. ` : 'Aún no hay mediciones guardadas. ') + (ro ? 'Solo tu nutricionista puede modificarlas.' : 'Edita cualquier valor o empieza una medición nueva; la anterior queda guardada.');
  $('#medHist').innerHTML = `<span class="eyebrow">Guardadas</span>` + P.mediciones.slice().reverse().map((m,i) => `<span class="hchip ${!S.isDraft && i === 0 ? 'on' : ''}">${fecha(m.f)} · ${Object.keys(m.med).length} medida${Object.keys(m.med).length === 1 ? '' : 's'}</span>`).join('') + (S.isDraft ? `<span class="hchip draft">${fecha(TODAY)} · en curso</span>` : '');
  $('#medGroups').innerHTML = `<div class="card estbar" id="estBar"></div>` + CAMPOS.map((g,gi) => `<div class="card mgroup"><div class="head"><h3>${g.g}</h3><span class="eyebrow">${g.sub}</span></div>
    <div class="fields">${g.f.map(([k,l,u,st]) => `<div class="field" id="f_${k}"><label for="m_${k}">${l}</label><div class="in"><input id="m_${k}" data-k="${k}" type="number" step="${st}" inputmode="decimal" placeholder="Sin registro" ${ro ? 'readonly' : ''}><span>${u}</span></div><div class="prevh" id="pv_${k}"></div>
      ${SIMK.includes(k) || VITK.includes(k) ? '' : `<div class="estrow"><span class="estchip">Estimado</span><button class="okb" data-ok="${k}" aria-label="Aceptar ${l}">✓</button><button class="nob" data-no="${k}" aria-label="Descartar ${l}">✕</button></div>`}</div>`).join('')}</div>
    <div class="calc" id="calc${gi}"></div>${gi === 3 ? '<div id="somato"></div>' : ''}</div>`).join('');
  $$('#medGroups input').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.k, raw = inp.value.trim(), v = parseFloat(raw);
    if (SIMK.includes(k)){ if (Number.isNaN(v) || v <= 0) return; S.sim[k] = v; syncInputs(); update(); return; }
    if (raw === ''){ delete S.med[k]; } else { if (Number.isNaN(v) || v <= 0) return; S.med[k] = v; S.rej.delete(k); }
    refreshMedidas(); S.drawn = false;
  }));
  $$('#medGroups [data-ok]').forEach(b => b.onclick = () => { const k = b.dataset.ok; if (S.est[k] != null){ S.med[k] = S.est[k]; } refreshMedidas(); });
  $$('#medGroups [data-no]').forEach(b => b.onclick = () => { const k = b.dataset.no; S.rej.add(k); refreshMedidas(); });
  refreshMedidas();
}
function cvalHTML([k,v,t]){
  const bad = typeof v === 'string' && /NaN|undefined|Infinity/.test(v);
  return `<div class="cval"><div class="k">${k}</div><div class="v ${bad ? 'empty' : ''}">${bad ? 'Faltan datos' : v}</div>${t && !bad ? `<div class="t" style="color:var(${t[1]})">${t[0]}</div>` : ''}</div>`;
}
function refreshMedidas(){
  if (!S.med || !$('#calc0')) return;
  estimar();
  const ro = S.rol !== 'nutri', est = S.est, nEst = Object.keys(est).length;
  SIMK.forEach(k => { const i = $(`#m_${k}`); if (i && document.activeElement !== i) i.value = S.sim[k]; });
  CAMPOS.forEach(g => g.f.forEach(([k]) => {
    if (SIMK.includes(k)) return;
    const i = $(`#m_${k}`), f = $(`#f_${k}`), isEst = S.med[k] == null && est[k] != null;
    f.classList.toggle('est', isEst); f.classList.toggle('missing', S.med[k] == null && !isEst);
    if (document.activeElement !== i) i.value = S.med[k] ?? est[k] ?? '';
  }));
  // valor de la medición anterior, para comparar
  CAMPOS.forEach(g => g.f.forEach(([k]) => { const e = $(`#pv_${k}`); if (!e) return; const v = SIMK.includes(k) ? null : S.prev?.[k]; e.textContent = v != null ? `Antes: ${n1(v)}` : ''; }));
  // barra de estimados
  const rejN = S.rej.size;
  $('#estBar').innerHTML = nEst || rejN ? `<div class="cv-row" style="justify-content:space-between;gap:10px">
      <div style="min-width:0"><b class="estword">${nEst} medida${nEst === 1 ? '' : 's'} estimada${nEst === 1 ? '' : 's'}</b>
      <p class="empty" style="margin:2px 0 0">${ro ? 'Algunas medidas son estimadas y tu nutricionista las confirmará.' : 'Se calculan con el peso, la estatura, el % de grasa, la edad y lo que ya mediste. Acepta las que te sirvan o reemplázalas midiendo; los indicadores las usan mientras tanto.'}</p></div>
      <div class="cv-row nutri-only" style="gap:6px">${nEst ? '<button class="btn btn-primary" id="estAll">Aceptar todas</button><button class="btn btn-outline-secondary" id="estNone">Descartar todas</button>' : ''}${rejN ? `<button class="btn btn-outline-secondary" id="estAgain">Volver a estimar (${rejN})</button>` : ''}</div></div>`
    : `<p class="empty" style="margin:0">Todas las medidas están registradas. ${ro ? '' : 'Usa “Nueva medición rápida” para tomar solo lo básico y estimar el resto.'}</p>`;
  if ($('#estAll')) $('#estAll').onclick = () => { Object.assign(S.med, S.est); refreshMedidas(); toast('Medidas estimadas aceptadas'); };
  if ($('#estNone')) $('#estNone').onclick = () => { Object.keys(S.est).forEach(k => S.rej.add(k)); refreshMedidas(); toast('Estimados descartados'); };
  if ($('#estAgain')) $('#estAgain').onclick = () => { S.rej.clear(); refreshMedidas(); };
  CAMPOS.forEach((_,gi) => { $(`#calc${gi}`).innerHTML = calcs(gi).map(cvalHTML).join(''); });
  if ($('#somato')) $('#somato').innerHTML = /NaN/.test(somatoChart()) ? '<p class="empty">Faltan datos para la somatocarta.</p>' : somatoChart();
  { const d = medAll(), c1 = calcs(1), c2 = calcs(2), c3 = calcs(3);
    const items = [['Cintura', `${n1(d.cintura)} cm`], ['Cadera', `${n1(d.cadera)} cm`], c1[0], c1[1], ['Brazo contraído', `${n1(d.brazoC)} cm`], c2[0], c3[0], c3[1]];
    $('#antroResumen').innerHTML = items.map(cvalHTML).join(''); }
  RINGS.forEach(r => { const v = S.med[r.k] ?? est[r.k]; RE[r.k].v.textContent = v == null ? 'Sin registro' : `${S.med[r.k] == null ? '≈ ' : ''}${n1(v)} cm`; RE[r.k].el.classList.toggle('estring', S.med[r.k] == null); });
}
$('#btnVerMed').onclick = () => { setTab('medidas'); window.scrollTo({ top:0, behavior:'smooth' }); };
$('#btnGuardarMed').onclick = async () => {
  const P = pac(), n = Object.keys(S.est).length, snap = { ...S.med };
  const last = P.mediciones.at(-1), nueva = S.isDraft || !last;
  const body = { date:nueva ? TODAY : last.f, weight_kg:S.sim.peso, fat_pct:S.sim.grasa, muscle_pct:S.sim.mus, height_cm:S.sim.talla, measures:snap };
  const h = { f:body.date, peso:S.sim.peso, grasa:S.sim.grasa, mus:S.sim.mus };
  try {
    if (nueva){
      const r = await API.addMeasure(body);
      P.mediciones.push({ id:r.id, f:TODAY, med:snap }); P.hist.push({ id:r.id, ...h });
      P.draft = null; S.isDraft = false; S.prev = P.mediciones.at(-2)?.med || null; S.med = { ...snap }; S.idx = P.hist.length - 1;
    } else {
      await API.updateMeasure(last.id, body);
      last.med = snap;
      const hh = P.hist.find(x => x.id === last.id);
      if (hh) Object.assign(hh, h); else { P.hist.push({ id:last.id, ...h }); P.hist.sort((a,b) => a.f.localeCompare(b.f)); }
    }
  } catch (e){ toast('No se guardó: ' + e.message); return; }
  P.talla = S.sim.talla; P.med = { ...snap }; renderMedidas();
  toast(n ? `Medición guardada. Quedaron ${n} estimadas sin aceptar` : `Medición de ${P.nombre} guardada`);
};
$('#btnRapida').onclick = () => {
  const P = pac();
  // si ya hay una medición nueva en curso, no se borra nada de lo que se llenó
  if (S.isDraft){ toast('Ya tienes una medición nueva en curso; lo que llenaste se conserva'); return; }
  // la medición actual queda guardada como anterior; la nueva arranca con la báscula y lo demás estimado
  S.prev = P.mediciones.length ? { ...P.mediciones.at(-1).med } : null;
  P.draft = {}; S.med = P.draft; S.isDraft = true; S.rej.clear();
  renderMedidas(); S.drawn = false; toast('Medición nueva: mide lo que puedas, el resto ya está estimado');
};

/* ---------- Historia clínica ---------- */
const LABS = [
  { k:'col', n:'Colesterol total', u:'mg/dL', ref:'< 200', st:v => v < 200 ? 0 : v < 240 ? 1 : 2 },
  { k:'ldl', n:'Colesterol LDL', u:'mg/dL', ref:'< 100', st:v => v < 100 ? 0 : v < 160 ? 1 : 2 },
  { k:'hdl', n:'Colesterol HDL', u:'mg/dL', ref:s => s === 'M' ? '≥ 40' : '≥ 50', st:(v,s) => v >= (s === 'M' ? 40 : 50) ? 0 : v >= (s === 'M' ? 35 : 45) ? 1 : 2 },
  { k:'tg', n:'Triglicéridos', u:'mg/dL', ref:'< 150', st:v => v < 150 ? 0 : v < 200 ? 1 : 2 },
  { k:'glu', n:'Glucosa en ayunas', u:'mg/dL', ref:'70 – 99', st:v => v < 100 ? 0 : v < 126 ? 1 : 2 },
  { k:'hba1c', n:'Hemoglobina glicosilada', u:'%', ref:'< 5,7', st:v => v < 5.7 ? 0 : v < 6.5 ? 1 : 2 },
  { k:'creat', n:'Creatinina', u:'mg/dL', ref:s => s === 'M' ? '0,7 – 1,3' : '0,6 – 1,1', st:(v,s) => v <= (s === 'M' ? 1.3 : 1.1) ? 0 : v <= (s === 'M' ? 1.5 : 1.3) ? 1 : 2 },
  { k:'tfg', n:'Filtración glomerular (TFG)', u:'mL/min', ref:'≥ 90', st:v => v >= 90 ? 0 : v >= 60 ? 1 : 2 },
  { k:'bun', n:'Nitrógeno ureico (BUN)', u:'mg/dL', ref:'7 – 20', st:v => v <= 20 ? 0 : v <= 30 ? 1 : 2 },
  { k:'urico', n:'Ácido úrico', u:'mg/dL', ref:s => s === 'M' ? '3,4 – 7,0' : '2,4 – 6,0', st:(v,s) => v <= (s === 'M' ? 7 : 6) ? 0 : v <= (s === 'M' ? 8 : 7) ? 1 : 2 },
  { k:'k', n:'Potasio', u:'mEq/L', ref:'3,5 – 5,0', st:v => v >= 3.5 && v <= 5 ? 0 : v >= 3.2 && v <= 5.5 ? 1 : 2 },
  { k:'hb', n:'Hemoglobina', u:'g/dL', ref:s => s === 'M' ? '13,5 – 17,5' : '12 – 15,5', st:(v,s) => v >= (s === 'M' ? 13.5 : 12) ? 0 : v >= (s === 'M' ? 12 : 10.5) ? 1 : 2 },
  { k:'vitd', n:'Vitamina D', u:'ng/mL', ref:'≥ 30', st:v => v >= 30 ? 0 : v >= 20 ? 1 : 2 },
  { k:'tsh', n:'TSH (tiroides)', u:'mUI/L', ref:'0,4 – 4,0', st:v => v >= .4 && v <= 4 ? 0 : v <= 6 ? 1 : 2 },
];
const STL = [['Normal','--good'],['Límite','--warn'],['Alterado','--bad']];
const LV = [['Bajo','--good'],['Moderado','--warn'],['Alto','--bad']];
const L = (f, v) => ({ f, v });
const C0 = D.clinical || {};
const CLIN = { [P0.id]: {
  lesiones:C0.lesiones || [], riesgos:C0.riesgos || [], cond:C0.cond || [], meds:C0.meds || [],
  alergias:C0.alergias || [], antecedentes:C0.antecedentes || [], habitos:C0.habitos || [],
  labs:D.labs.map(x => ({ id:x.id, f:x.date, v:x.vals })),
} };
const clinDoc = () => { const { labs, ...rest } = clin(); return rest; };
const clin = () => CLIN[S.pid];
// último valor conocido de cada examen (y el anterior), trabajando solo con lo registrado
function known(){
  const out = {}, prev = {};
  clin().labs.forEach(r => Object.entries(r.v).forEach(([k,v]) => { if (v == null) return; if (out[k]) prev[k] = out[k]; out[k] = { v, f:r.f }; }));
  return { out, prev };
}
const labV = () => Object.fromEntries(Object.entries(known().out).map(([k,o]) => [k, o.v]));
const lastLab = () => ({ v: labV() });
const hasCond = re => clin().cond.some(c => re.test(c.n));
const RTYPES = { cv:'Cardiovascular', renal:'Renal', metab:'Metabólico', hep:'Hepático', nutri:'Nutricional', oseo:'Óseo', art:'Articular', col:'Columna', resp:'Respiratorio', dig:'Digestivo', tiroides:'Tiroides', circ:'Circulación', mental:'Salud mental', otro:'Otro' };
function riesgos(id = S.pid){
  return (CLIN[id].riesgos || []).map(r => ({ k:r.k, n:RTYPES[r.k] || 'Otro', lv:r.lv, why:[r.nota || ''] }));
}
function alertasPlan(){
  const lab = lastLab()?.v || {}, c = clin(), a = [];
  const meds = c.meds.map(m => m.n.toLowerCase());
  if (lab.tfg < 60 || hasCond(/renal/i)){
    a.push(['Riñón','Moderar la proteína (cerca de 0,8 g por kg al día) y repartirla en el día.']);
    a.push(['Potasio','Limitar banano, aguacate, papa, naranja y tomate. Preferir manzana, pera, fresas y piña.']);
  }
  if (lab.k > 5 && meds.includes('losartán')) a.push(['Medicamento','El losartán puede subir el potasio: vigilar frutas y verduras altas en potasio.']);
  if (lab.ldl >= 130) a.push(['Colesterol','Reducir grasas saturadas: mantequilla, crema de leche, cerdo y embutidos.']);
  if (hasCond(/hipertensi/i) || S.med.pas >= 130) a.push(['Presión','Menos de 5 g de sal al día. Evitar salchicha, jamón, enlatados y paquetes.']);
  if (lab.hba1c >= 5.7) a.push(['Glucosa','Harinas en porción medida, sin azúcares añadidos. Dulces solo dentro de la meta semanal.']);
  if (lab.urico > (S.sim.sexo === 'M' ? 7 : 6) || hasCond(/gota/i)) a.push(['Ácido úrico','Limitar vísceras, mariscos, cerveza y bebidas azucaradas.']);
  if (meds.includes('metformina')) a.push(['Medicamento','La metformina reduce la vitamina B12 con el tiempo: revisar B12 cada año.']);
  if (meds.includes('atorvastatina')) a.push(['Medicamento','Atorvastatina: evitar jugo de toronja.']);
  if (meds.includes('sulfato ferroso')) a.push(['Medicamento','Tomar el hierro lejos de lácteos y café; acompañarlo con fruta rica en vitamina C.']);
  if (lab.hb < (S.sim.sexo === 'M' ? 13.5 : 12)) a.push(['Hierro','Incluir carnes rojas magras, leguminosas y hojas verdes.']);
  if (lab.vitd < 30) a.push(['Vitamina D','Exposición al sol 15 minutos al día y revisar suplemento con el médico.']);
  if (c.alergias.some(x => /lactosa/i.test(x))) a.push(['Intolerancia','Usar lácteos deslactosados.']);
  return a;
}
// alimentos de la lista de intercambios que conviene limitar según la salud del paciente
function foodFlags(){
  const lab = lastLab()?.v || {}, f = {};
  const add = (list, why) => list.forEach(n => f[n] = (f[n] ? f[n] + ' · ' : '') + why);
  if (lab.tfg < 60 || lab.k > 5) add(['Banano','Aguacate','Papa común','Papa criolla','Naranja','Tomate','Guanábana','Plátano','Kiwi','Leguminosas'], 'alto en potasio');
  if (lab.ldl >= 130) add(['Mantequilla','Crema de leche','Cerdo','Salchicha','Jamón','Queso crema'], 'grasa saturada');
  if (hasCond(/hipertensi/i)) add(['Salchicha','Jamón','Atún','Galletas tipo soda','Rosquillas o chitos'], 'alto en sodio');
  if (lab.hba1c >= 5.7) add(['Cereal','Waffle','Azúcar','Mermelada','Miel','Lecherita','Arequipe','Panela molida','Bocadillo'], 'sube la glucosa');
  return f;
}
const RPOS = {
  mental:{ n:'SALUD MENTAL', x:130, y:30 }, tiroides:{ n:'RIESGO TIROIDES', x:130, y:57 }, resp:{ n:'RIESGO PULMÓN', x:121, y:94 },
  cv:{ n:'RIESGO CORAZÓN', x:137, y:104 }, hep:{ n:'RIESGO HÍGADO', x:122, y:122 }, metab:{ n:'RIESGO METAB.', x:137, y:128 },
  dig:{ n:'RIESGO DIGESTIVO', x:130, y:136 }, renal:{ n:'RIESGO RIÑÓN', x:124, y:147 }, oseo:{ n:'RIESGO ÓSEO', x:130, y:198 },
  art:{ n:'RIESGO ARTICULAR', x:120, y:292 }, col:{ n:'RIESGO COLUMNA', x:130, y:170 }, circ:{ n:'CIRCULACIÓN', x:120, y:340 } };
function paintOrgans(rs){
  const g = $('#riskCallouts'), Ys = [122, 160, 198, 236];
  const pick = rs.filter(r => r.lv > 0 && RPOS[r.k]).sort((a,b) => b.lv - a.lv).slice(0, 4).sort((a,b) => RPOS[a.k].y - RPOS[b.k].y);
  g.innerHTML = pick.map((r, i) => {
    const q = RPOS[r.k], c = `var(${LV[r.lv][1]})`, ly = Ys[i];
    return `<line x1="66" y1="${ly + 2}" x2="${q.x}" y2="${q.y}"/><circle class="pt ${r.lv === 2 ? 'alert' : ''}" cx="${q.x}" cy="${q.y}" r="3.2" style="fill:${c};stroke:var(--on-stage);stroke-width:1"/>`+
      `<text class="k" x="8" y="${ly - 4}">${q.n}</text><text class="rv" x="8" y="${ly + 8}" style="fill:${c}">${LV[r.lv][0]}</text>`;
  }).join('');
  drawMeds(); S.drawn = false;
}
// medicamentos junto a las piernas: hasta 10 (5 por lado), pensado para pacientes polimedicados
function drawMeds(){
  const meds = clin().meds, g = $('#medCallouts');
  if (!meds.length){ g.innerHTML = ''; return; }
  const MAX = 10, show = meds.slice(0, MAX), extra = meds.length - show.length;
  const pill = (x, y) => `<g transform="translate(${x},${y}) rotate(-30) scale(.75)"><rect x="-6" y="-2.6" width="12" height="5.2" rx="2.6" style="fill:var(--on-stage)"/><rect x="0" y="-2.6" width="6" height="5.2" rx="2.6" style="fill:var(--fat)"/></g>`;
  const cut = t => t.length > 14 ? t.slice(0, 13) + '…' : t;
  let html = `<text class="k" x="8" y="276">MEDICAMENTOS · ${meds.length}</text>`;
  show.forEach((m, i) => {
    const L = i % 2 === 0, row = Math.floor(i / 2), y = 292 + row * 22;
    const tx = L ? 19 : 241, an = L ? 'start' : 'end', px = L ? 11 : 249;
    html += `<g>${pill(px, y - 3)}<text class="mn" x="${tx}" y="${y}" text-anchor="${an}">${esc(cut(m.n))}</text><text class="md" x="${tx}" y="${y + 8.5}" text-anchor="${an}">${esc(m.dosis)}</text><title>${esc(m.n)} ${esc(m.dosis)} · ${esc(m.h)} · ${esc(m.para)}</title></g>`;
  });
  if (extra > 0) html += `<text class="md" x="8" y="${292 + 5*22}">+${extra} más en Salud</text>`;
  g.innerHTML = html;
}
// lesiones y molestias: se ven en la vista Silueta. Derecha del paciente = izquierda de la pantalla.
const ZONAS = { cerv:'Cervical', hombroD:'Hombro derecho', hombroI:'Hombro izquierdo', lumbar:'Lumbar', caderaD:'Cadera derecha', caderaI:'Cadera izquierda', rodD:'Rodilla derecha', rodI:'Rodilla izquierda', tobD:'Tobillo derecho', tobI:'Tobillo izquierdo' };
const LES = [['Leve','--warn'],['Moderada','--fat'],['Severa','--bad']];
function zonaPos(z, sh){
  const B = sh.body, side = z.endsWith('D') ? -1 : 1;
  switch (z){
    case 'cerv': return [CX, B[6][1] + 1, 0];
    case 'lumbar': return [CX, 170, 0];
    case 'hombroD': case 'hombroI': return [CX + side*(B[8][0] - 3), B[8][1] + 5, side];
    case 'caderaD': case 'caderaI': return [CX + side*B[15][0]*.72, B[15][1] + 4, side];
    case 'rodD': case 'rodI': return [CX + side*(B[19][0] + B[29][0])/2, B[19][1], side];
    default: return [CX + side*(B[22][0] + B[26][0])/2, B[22][1] - 2, side];
  }
}
function drawLesions(sh){
  const ls = clin().lesiones || [], g = $('#lesCallouts');
  const items = ls.map(l => ({ l, p:zonaPos(l.z, sh) })).sort((a,b) => a.p[1] - b.p[1]);
  const left = items.filter(x => x.p[2] <= 0), right = items.filter(x => x.p[2] > 0);
  const LY = [130, 178, 226, 268, 310, 352, 394], RY = [100, 196, 262, 304, 346, 388];
  const cut = t => t.length > 15 ? t.slice(0, 14) + '…' : t;
  let html = '';
  const put = (arr, ys, L) => { const free = ys.slice(); arr.forEach(x => {
    if (!free.length) return;
    // la ranura libre más cercana a la altura de la lesión, para que la línea sea corta
    let bi = 0; free.forEach((y, i) => { if (Math.abs(y - x.p[1]) < Math.abs(free[bi] - x.p[1])) bi = i; });
    const ly = free.splice(bi, 1)[0];
    const [px, py] = x.p, c = `var(${LES[x.l.lv][1]})`, tx = L ? 8 : 252, an = L ? 'start' : 'end';
    html += `<line x1="${L ? 74 : 186}" y1="${ly + 2}" x2="${px}" y2="${py}"/><circle cx="${px}" cy="${py}" r="3.4" style="fill:${c};stroke:var(--on-stage);stroke-width:1"/><circle class="ring" cx="${px}" cy="${py}" r="5" style="stroke:${c}"/>`+
      `<text class="k" x="${tx}" y="${ly - 4}" text-anchor="${an}" style="fill:${c}">${ZONAS[x.l.z].toUpperCase()}</text><text class="ln" x="${tx}" y="${ly + 8}" text-anchor="${an}">${esc(cut(x.l.n))}</text><title>${esc(ZONAS[x.l.z])}: ${esc(x.l.n)} · ${LES[x.l.lv][0]} · desde ${esc(x.l.d)}</title>`;
  }); };
  put(left, LY, true); put(right, RY, false);
  g.innerHTML = html;
}
function renderRiskBanner(){
  const rs = riesgos(); paintOrgans(rs);
  const altos = rs.filter(r => r.lv > 0);
  $('#riskBanner').innerHTML = `<div class="cv-row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0">Riesgos de salud</h3><button class="btn btn-outline-secondary" id="btnVerSalud">Ver historia clínica</button></div>
    <div class="rchips">${rs.length ? rs.map(r => `<span class="rchip" style="--c:var(${LV[r.lv][1]})" title="${esc(r.why[0])}"><i></i>${r.n}: <b>${LV[r.lv][0]}</b></span>`).join('') : '<span class="empty">Sin riesgos registrados por la nutricionista.</span>'}</div>
    ${(clin().lesiones || []).length ? `<p class="empty" style="margin:10px 0 0">Lesiones: ${clin().lesiones.map(l => `${ZONAS[l.z].toLowerCase()} (${esc(l.n.toLowerCase())})`).join(', ')}. Se ven en la vista Silueta.</p>` : ''}
    ${clin().meds.length ? `<p class="empty" style="margin:10px 0 0">${clin().meds.length} medicamento${clin().meds.length > 1 ? 's' : ''} activo${clin().meds.length > 1 ? 's' : ''}: ${clin().meds.map(m => m.n).join(', ')}.</p>` : ''}`;
  $('#btnVerSalud').onclick = () => { setTab('salud'); window.scrollTo({ top:0, behavior:'smooth' }); };
}
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
function renderSalud(){
  const c = clin(), rs = riesgos(), sx = S.sim.sexo, labs = c.labs, { out, prev } = known(), last = labs.at(-1);
  // riesgos registrados por la nutricionista
  $('#riskList').innerHTML = rs.length ? rs.map((r,i) => `<li class="rrow" style="--c:var(${LV[r.lv][1]})"><span><span class="rlv">${LV[r.lv][0]}</span> <b>${r.n}</b>${r.why[0] ? ` <span class="empty">· ${esc(r.why[0])}</span>` : ''}${c.riesgos[i].from ? ' <span class="linktag">Desde lesiones</span>' : ''}</span><button class="rm" data-rm="riesgos.${i}" aria-label="Quitar riesgo ${r.n}">×</button></li>`).join('') : '<li class="empty">Sin riesgos registrados.</li>';
  // alertas
  const al = alertasPlan();
  $('#planAlerts').innerHTML = al.length ? al.map(([t,x]) => `<li><span class="atag">${t}</span>${esc(x)}</li>`).join('') : '<li class="empty">Sin ajustes especiales al plan con los datos registrados.</li>';
  // laboratorios: lo que no se sabe queda "Sin registro"
  const nKnown = LABS.filter(l => out[l.k]).length;
  $('#labInfo').textContent = last ? `Último examen: ${fecha(last.f)} 2026 · ${nKnown} de ${LABS.length} exámenes con dato` : 'Sin exámenes registrados';
  $('#labBody').innerHTML = LABS.map(l => {
    const ref = typeof l.ref === 'function' ? l.ref(sx) : l.ref, o = out[l.k];
    if (!o) return `<tr class="nodata"><td>${l.n}</td><td class="empty">Sin registro</td><td class="empty">—</td><td></td><td class="num empty">${ref}</td><td><span class="lv none">Sin dato</span></td></tr>`;
    const v = o.v, pv = prev[l.k]?.v, st = l.st(v, sx);
    const diff = pv != null ? v - pv : null;
    const arrow = diff == null ? '<span class="empty">—</span>' : Math.abs(diff) < 1e-9 ? '<span class="empty">igual</span>' : `<span class="num">${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff), Math.abs(diff) % 1 ? (Math.abs(diff) < 1 ? 2 : 1) : 0)}</span>`;
    const vs = labs.map(x => x.v[l.k]).filter(x => x != null);
    const spark = vs.length > 1 ? (() => { const lo = Math.min(...vs), hi = Math.max(...vs); return `<svg width="60" height="20" viewBox="0 0 60 20" aria-hidden="true"><path d="${vs.map((x,i) => `${i ? 'L' : 'M'}${3 + i*54/(vs.length-1)},${hi === lo ? 10 : 3 + (hi-x)/(hi-lo)*14}`).join(' ')}" fill="none" stroke="var(${STL[st][1]})" stroke-width="2"/></svg>`; })() : '';
    const old = last && o.f !== last.f ? `<div class="empty" style="font-size:11.5px">del ${fecha(o.f)}</div>` : '';
    return `<tr><td>${l.n}</td><td class="num"><b>${fmt(v, l.k === 'creat' ? 2 : (l.k === 'hba1c' || v % 1) ? 1 : 0)}</b> <span class="empty">${l.u}</span>${old}</td><td>${arrow}</td><td>${spark}</td><td class="num empty">${ref}</td><td><span class="lv" style="background:color-mix(in srgb, var(${STL[st][1]}) 18%, transparent);color:var(${STL[st][1]})">${STL[st][0]}</span></td></tr>`;
  }).join('');
  $('#labForm').innerHTML = LABS.map(l => `<div class="field"><label for="lab_${l.k}">${l.n}</label><div class="in"><input id="lab_${l.k}" type="number" step="0.01" placeholder="Sin registro"><span>${l.u}</span></div></div>`).join('');
  // condiciones
  $('#condList').innerHTML = c.cond.length ? c.cond.map((x,i) => `<li><span><b>${esc(x.n)}</b> <span class="empty">desde ${esc(x.d)}</span>${x.from ? ' <span class="linktag">Desde lesiones</span>' : ''}</span><button class="rm" data-rm="cond.${i}" aria-label="Quitar ${esc(x.n)}">×</button></li>`).join('') : '<li class="empty">Sin diagnósticos registrados.</li>';
  // medicamentos
  $('#medBody').innerHTML = c.meds.length ? c.meds.map((m,i) => `<tr><td><b>${esc(m.n)}</b></td><td class="num">${esc(m.dosis)}</td><td>${esc(m.h)}</td><td>${esc(m.para)}</td><td><button class="rm" data-rm="meds.${i}" aria-label="Quitar ${esc(m.n)}">×</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Sin medicamentos registrados.</td></tr>';
  // listas
  const ls = c.lesiones || (c.lesiones = []);
  $('#lesList').innerHTML = ls.length ? ls.map((l,i) => `<li class="rrow" style="--c:var(${LES[l.lv][1]})"><span><span class="rlv">${LES[l.lv][0]}</span> <b>${ZONAS[l.z]}</b> <span class="empty">· ${esc(l.n)} · desde ${esc(l.d)}</span></span><button class="rm" data-rm="lesiones.${i}" aria-label="Quitar lesión">×</button></li>`).join('') : '<li class="empty">Sin lesiones registradas.</li>';
  [['alergias','#alerList'],['antecedentes','#antList'],['habitos','#habList']].forEach(([k,sel]) => {
    $(sel).innerHTML = c[k].map((x,i) => `<li><span>${esc(x)}</span><button class="rm" data-rm="${k}.${i}" aria-label="Quitar">×</button></li>`).join('') || '<li class="empty">Nada registrado.</li>';
  });
  $$('#saludPanel .rm').forEach(b => b.onclick = () => {
    const [k,i] = b.dataset.rm.split('.'), c = clin(), item = c[k][Number(i)];
    if (k === 'lesiones') { unlinkLesion(c, item.id); saved('Lesión, diagnóstico y riesgo eliminados'); return; }
    if (item && item.from) { unlinkLesion(c, item.from); saved('Lesión, diagnóstico y riesgo eliminados'); return; }
    c[k].splice(Number(i), 1); saved('Eliminado');
  });
}
function saved(msg){ renderSalud(); renderRiskBanner(); if (S.tab === 'plan') renderPlan(); persistAll(); toast(`${msg} en la historia de ${pac().nombre}`); }
function bindSalud(){
  $('#btnNewLab').onclick = () => { $('#labFormBox').hidden = !$('#labFormBox').hidden; };
  $('#btnSaveLab').onclick = async () => {
    const f = $('#labDate').value; if (!f){ toast('Elige la fecha del examen'); return; }
    const v = {}; LABS.forEach(l => { const x = parseFloat($('#lab_'+l.k).value); if (!Number.isNaN(x)) v[l.k] = x; });
    if (!Object.keys(v).length){ toast('Escribe al menos un resultado'); return; }
    try { const r = await API.addLab({ date:f, vals:v }); clin().labs.push({ id:r.id, f, v }); }
    catch (e){ toast('No se guardó: ' + e.message); return; }
    clin().labs.sort((a,b) => a.f.localeCompare(b.f)); $('#labFormBox').hidden = true; saved('Examen guardado');
  };
  $('#lsZona').innerHTML = Object.entries(ZONAS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('');
  $('#btnAddLes').onclick = () => { const n = $('#lsNote').value.trim(); if (!n){ toast('Describe la lesión'); return; } const l = { z:$('#lsZona').value, n, lv:Number($('#lsLv').value), d:$('#lsYear').value.trim() || TODAY.slice(0, 4) }; clin().lesiones.push(l); linkLesion(clin(), l); $('#lsNote').value = ''; $('#lsYear').value = ''; saved('Lesión guardada, con su diagnóstico y riesgo'); };
  $('#btnAddRisk').onclick = () => { clin().riesgos.push({ k:$('#rkType').value, lv:Number($('#rkLv').value), nota:$('#rkNote').value.trim() }); $('#rkNote').value = ''; saved('Riesgo guardado'); };
  $('#btnAddCond').onclick = () => { const n = $('#condName').value.trim(); if (!n){ toast('Escribe el diagnóstico'); return; } clin().cond.push({ n, d:$('#condYear').value.trim() || TODAY.slice(0, 4) }); $('#condName').value = ''; $('#condYear').value = ''; saved('Diagnóstico guardado'); };
  $('#btnAddMed').onclick = () => {
    const n = $('#medName').value.trim(); if (!n){ toast('Escribe el nombre del medicamento'); return; }
    clin().meds.push({ n, dosis:$('#medDose').value.trim() || '—', h:$('#medTime').value.trim() || '—', para:$('#medFor').value.trim() || '—' });
    ['#medName','#medDose','#medTime','#medFor'].forEach(s => $(s).value = ''); saved('Medicamento guardado');
  };
  [['alergias','#alerIn','#btnAlerAdd'],['antecedentes','#antIn','#btnAntAdd'],['habitos','#habIn','#btnHabAdd']].forEach(([k,inp,btn]) => {
    $(btn).onclick = () => { const t = $(inp).value.trim(); if (!t) return; clin()[k] = clin()[k].filter(x => !/^ningun/i.test(x)); clin()[k].push(t); $(inp).value = ''; saved('Guardado'); };
  });
}

/* ---------- Navegación ---------- */
const TAB_ORDER = ['cuerpo', 'medidas', 'salud', 'evolucion', 'plan', 'ficha'];
function setTab(t){
  if (t === 'ficha' && S.rol !== 'nutri') t = 'cuerpo';
  const prev = S.tab; S.tab = t;
  $('#app').dataset.tab = t;
  if (t === 'medidas' && S.vista !== 'medidas'){ S.prevVista = S.vista; setVista('medidas'); }
  else if (prev === 'medidas' && t !== 'medidas' && S.vista === 'medidas') setVista(S.prevVista || 'capas');
  $$('.cv-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t);
  // Transición: la sección entra desde el lado hacia el que se avanza.
  const panel = $(`[data-panel="${t}"]`), dir = TAB_ORDER.indexOf(t) - TAB_ORDER.indexOf(prev);
  if (panel && prev !== t){
    panel.style.setProperty('--enter-x', dir > 0 ? '28px' : dir < 0 ? '-28px' : '0px');
    panel.classList.remove('cv-enter'); void panel.offsetWidth; panel.classList.add('cv-enter');
    if (window.innerWidth <= 860) window.scrollTo({ top:0, behavior:'smooth' });
  }
  cfg.onTab?.(t);
  if (t === 'evolucion') renderTimeline();
  if (t === 'plan') renderPlan();
  if (t === 'salud') renderSalud();
  if (t !== 'evolucion') stopPlay();
}
function setPaciente(id){
  stopPlay(); S.pid = id; S.idx = pac().hist.length - 1; S.lastLevel = null;
  loadSim(); { const P = pac(), M = P.mediciones; if (P.draft){ S.med = P.draft; S.isDraft = true; S.prev = M.at(-1)?.med || null; } else { S.med = { ...(M.at(-1)?.med || {}) }; S.isDraft = false; S.prev = M.at(-2)?.med || null; } } S.est = {}; S.rej = new Set(); renderMedidas(); update(); renderRecs(); renderHead(); renderRiskBanner(); renderSalud();
  if (S.tab === 'plan') renderPlan();
  if (S.tab === 'evolucion') renderTimeline();
}
function renderHead(){
  const p = pac(), nut = S.rol === 'nutri';
  $('#stageWho').textContent = P0.birth_date ? `${p.nombre} · ${p.edad} años` : p.nombre;
  $('#recTitle').textContent = nut ? `Recomendaciones para ${p.nombre.split(' ')[0]}` : 'Recomendaciones de tu nutricionista';
  $('.cv-tabs [data-tab="cuerpo"] span').textContent = nut ? 'Cuerpo' : 'Mi cuerpo';
  $('#cvName').textContent = p.nombre;
  $('#avatar').textContent = p.ini;
  const sin = p.hist.length ? '' : ' · Aún sin mediciones';
  const datos = [P0.birth_date ? `${p.edad} años` : null, P0.sex === 'F' ? 'Mujer' : P0.sex === 'M' ? 'Hombre' : null, P0.height_cm ? `${p.talla} cm` : null].filter(Boolean).join(' · ');
  $('#nota').textContent = (nut ? (datos || 'Completa sus datos en Ficha') : `${NUTRI} · tu seguimiento nutricional`) + sin;
}
function setRol(r){
  S.rol = r; document.body.classList.toggle('is-nutri', r === 'nutri');
  $('#app').classList.toggle('is-nutri', r === 'nutri');
  $('#rolPaciente').setAttribute('aria-pressed', r === 'paciente'); $('#rolNutri').setAttribute('aria-pressed', r === 'nutri');
  if (r === 'paciente') setPaciente(S.pid); else renderHead();
  renderMedidas();
  editPlan = r === 'nutri';
  if (S.tab === 'ficha' && r !== 'nutri') setTab('cuerpo');
  if (S.tab === 'plan') renderPlan();
}

$('#rolPaciente').onclick = () => setRol('paciente');
$('#rolNutri').onclick = () => setRol('nutri');
$$('.cv-tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function setVista(v){
  S.vista = v; $('#figure').classList.toggle('silueta', v === 'silueta'); $('#figure').classList.toggle('medidas', v === 'medidas');
  $('#vCapas').setAttribute('aria-pressed', v === 'capas'); $('#vSilueta').setAttribute('aria-pressed', v === 'silueta'); $('#vMedidas').setAttribute('aria-pressed', v === 'medidas');
  S.drawn = false;
}
$('#vCapas').onclick = () => setVista('capas');
$('#vSilueta').onclick = () => setVista('silueta');
$('#vMedidas').onclick = () => setVista('medidas');
[['#inPeso','peso'],['#inTalla','talla'],['#inGrasa','grasa'],['#inMus','mus']].forEach(([sel,k]) => $(sel).addEventListener('input', e => { S.sim[k] = Number(e.target.value); update(); }));
$('#sxF').onclick = () => { S.sim.sexo = 'F'; syncInputs(); update(); };
$('#sxM').onclick = () => { S.sim.sexo = 'M'; syncInputs(); update(); };
$('#btnReset').onclick = () => { S.lastLevel = null; loadSim(); update(); };

// Cada lesión crea un diagnóstico y un riesgo enlazados; al quitar cualquiera de los tres se quitan todos
function linkLesion(c, l){
  l.id = l.id || 'L' + Math.random().toString(36).slice(2, 9);
  const tipo = /lumbar|cerv/.test(l.z) ? 'col' : 'art', zona = ZONAS[l.z];
  if (!c.riesgos.some(r => r.from === l.id)) c.riesgos.push({ k:tipo, lv:l.lv, nota:`${zona}: ${l.n.toLowerCase()}`, from:l.id });
  if (!c.cond.some(d => d.from === l.id)) c.cond.push({ n:`${l.n} en ${zona.toLowerCase()}`, d:l.d, from:l.id });
}
function unlinkLesion(c, id){
  c.lesiones = (c.lesiones || []).filter(l => l.id !== id);
  c.riesgos = c.riesgos.filter(r => r.from !== id);
  c.cond = c.cond.filter(d => d.from !== id);
}
Object.values(CLIN).forEach(c => (c.lesiones || []).forEach(l => linkLesion(c, l)));
bindSalud();
$('#labDate').value = TODAY;
{ const [y,m,d] = TODAY.split('-').map(Number); $('#planSub').textContent = 'Hoy, ' + new Date(Date.UTC(y, m-1, d)).toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long', timeZone:'UTC' }); }
if (!cfg.canSwitch) $('#rolSeg').hidden = true;
setPaciente(S.pid);
setRol(S.rol);
setTab(TAB_ORDER.includes(cfg.initialTab) ? cfg.initialTab : 'cuerpo');
requestAnimationFrame(tick);

// Guardado automático: cada documento se envía (con pausa) solo si cambió.
function saver(build, send){
  let last = JSON.stringify(build()), t;
  return () => { clearTimeout(t); t = setTimeout(async () => {
    const doc = build(), str = JSON.stringify(doc);
    if (str === last) return;
    try { await send(doc); last = str; } catch (e){ toast('No se pudo guardar: ' + e.message); }
  }, 600); };
}
const nutriOnly = f => () => { if (S.rol === 'nutri') f(); };
SAVERS = [
  API.saveClinical && nutriOnly(saver(clinDoc, API.saveClinical)),
  API.savePlan && nutriOnly(saver(planDoc, API.savePlan)),
  API.saveTracking && saver(trackDoc, API.saveTracking),
  cfg.mode === 'paciente' && API.saveLog && saver(logDoc, doc => API.saveLog(TODAY, doc)),
].filter(Boolean);
['input', 'change', 'click'].forEach(ev => $('[data-panel="plan"]').addEventListener(ev, () => setTimeout(persistAll)));
// Controlador para la página que carga Cuerpo Vivo (vista previa del paciente, pestañas).
return { setRol, setTab, toast, planDoc, get rol(){ return S.rol; }, get tab(){ return S.tab; } };
} };
