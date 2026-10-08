// CD Nutrición — Worker monolítico: API + panel admin (HTML estáticos).
import { WorkerEntrypoint } from 'cloudflare:workers';
import { platformCall } from './lib/platform-rpc.js';
import { Router } from './router.js';
import { HttpError, errorResponse } from './lib/http.js';
import { authenticate, loadSession } from './lib/auth.js';
import { slugFromPath, businessBySlug, defaultSlug, isMember } from './lib/tenant.js';
import * as authApi from './api/auth.js';
import * as dashboardApi from './api/dashboard.js';
import * as patientsApi from './api/patients.js';
import * as appointmentsApi from './api/appointments.js';
import * as filesApi from './api/files.js';
import * as businessApi from './api/business.js';
import * as platformApi from './api/platform.js';
import * as cuerpoApi from './api/cuerpo.js';
import * as demoApi from './api/demo.js';
import * as publicApi from './api/public.js';
import * as cardApi from './api/card.js';
import { parseCard, logoUrl, isValidHandle, memberCardData } from './api/card.js';

const router = new Router();
for (const mod of [authApi, dashboardApi, patientsApi, appointmentsApi, filesApi, businessApi, platformApi, cuerpoApi, demoApi, publicApi, cardApi]) {
  mod.routes(router);
}

const SECURITY_HEADERS = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

async function handleApi(req, env, ctx, url) {
  const { route, params } = router.match(req.method, url.pathname);
  // Protección CSRF: toda mutación debe traer este encabezado (fuerza preflight entre orígenes).
  // Diwilo Web (nivel 'platform') no usa cookies: entra por RPC (Platform.call).
  if (req.method !== 'GET' && route.auth !== 'platform' && req.headers.get('x-cdn') !== '1') {
    throw new HttpError(403, 'Solicitud no permitida');
  }
  const c = { req, env, ctx, url, params };
  await authenticate(c, route.auth);
  return route.handler(c);
}

const assetAt = (env, req, path) => {
  const u = new URL(req.url);
  u.pathname = path;
  return env.ASSETS.fetch(new Request(u, req));
};

// Las redirecciones de los assets (p. ej. /admin -> /admin/) deben conservar el prefijo /<slug>.
function keepPrefix(res, prefix, url) {
  const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
  if (!loc) return res;
  const l = new URL(loc, url);
  return Response.redirect(`${url.origin}${prefix}${l.pathname}${l.search}`, 302);
}

const notFound = (msg) => new HttpError(404, msg || 'Esta página no existe.');

// ---------- tarjeta digital instalable ----------

const THEME = '#1388A5';

// Datos para la página, el manifiesto y el SW de una tarjeta (consultorio o profesional).
function businessCardInfo(business) {
  const card = parseCard(business.card);
  return {
    base: `/${business.slug}`, name: business.name,
    desc: card.bio || card.specialty || 'Seguimiento nutricional personalizado',
    img: logoUrl(business.slug, business.logo_key),
  };
}
function memberCardInfo(data) {
  return {
    base: `/${data.path}`, name: data.name,
    desc: data.card.specialty ? `${data.card.specialty} · ${data.org}` : data.card.bio || data.org,
    img: data.logo,
  };
}

// HTML de la tarjeta con su título, descripción, foto (vista previa al compartir) y manifiesto.
async function cardPage(env, url, info) {
  const plain = new URL(url); plain.pathname = '/negocio'; plain.search = '';
  const res = await env.ASSETS.fetch(new Request(plain));  // sin encabezados condicionales: el HTML varía por tarjeta
  const img = url.origin + (info.img || '/cv/icon-512.png');
  const attr = (name, value) => ({ element(e) { e.setAttribute(name, value); } });
  const out = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(info.name); } })
    .on('meta[name="description"]', attr('content', info.desc))
    .on('meta[property="og:title"]', attr('content', info.name))
    .on('meta[property="og:description"]', attr('content', info.desc))
    .on('meta[property="og:image"]', attr('content', img))
    .on('meta[property="og:url"]', attr('content', url.origin + info.base))
    .on('link[rel="manifest"]', attr('href', `${info.base}/manifest.webmanifest`))
    .on('link[rel="apple-touch-icon"]', attr('href', info.img ? img : '/cv/icon-180.png'))
    .on('meta[name="apple-mobile-web-app-title"]', attr('content', info.name.slice(0, 30)))
    .transform(res);
  const h = new Headers(out.headers);
  h.delete('etag');
  h.set('cache-control', 'no-cache');
  return new Response(out.body, { status: res.status, headers: h });
}

function manifest(info) {
  const icons = info.img
    ? [{ src: info.img, sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: info.img, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: info.img, sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    : [{ src: '/cv/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/cv/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }];
  return new Response(JSON.stringify({
    id: info.base,
    name: info.name,
    short_name: info.name.length > 24 ? info.name.split(' ')[0].slice(0, 24) : info.name,
    description: info.desc,
    start_url: `${info.base}?src=app`,
    scope: info.base,
    display: 'standalone',
    background_color: '#F2F5FA',
    theme_color: THEME,
    lang: 'es',
    icons,
  }), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' } });
}

// Service worker mínimo: guarda la tarjeta para que abra aunque no haya conexión.
function serviceWorker(base) {
  const js = `const CACHE = 'tarjeta-${base.replace(/\W+/g, '-')}-v1', PAGE = '${base}';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.add(PAGE))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.mode !== 'navigate' || (u.pathname !== PAGE && u.pathname !== PAGE + '/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(PAGE, copy)); return r; })
    .catch(() => caches.match(PAGE)));
});`;
  return new Response(js, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': base },
  });
}

// /<slug>, /<slug>/admin/…, /<slug>/p/
async function handleBusinessPath(req, env, url, slug) {
  const rest = url.pathname.slice(slug.length + 1) || '/';
  const business = await businessBySlug(env, slug);
  if (!business) {
    // Dirección anterior (el consultorio cambió de enlace): redirige a la actual conservando el resto.
    const alias = await env.DB.prepare(
      'SELECT b.slug FROM business_slug_aliases a JOIN businesses b ON b.id = a.business_id WHERE a.slug = ?',
    ).bind(slug).first();
    if (alias) return Response.redirect(`${url.origin}/${alias.slug}${rest === '/' ? '' : rest}${url.search}`, 301);
  }
  if (!business || business.status !== 'active') throw notFound('No encontramos este consultorio.');

  if (rest === '/') return cardPage(env, url, businessCardInfo(business));
  if (rest === '/manifest.webmanifest') return manifest(businessCardInfo(business));
  if (rest === '/sw.js') return serviceWorker(`/${slug}`);
  if (rest === '/p' || rest === '/p/') return assetAt(env, req, '/p/');
  if (rest === '/admin' || rest.startsWith('/admin/')) {
    if (rest.startsWith('/admin/assets/')) return assetAt(env, req, rest);
    const page = rest.replace(/\.html$/, '').replace(/\/$/, '');
    if (page !== '/admin/login' && !(await loadSession(req, env))) {
      return Response.redirect(`${url.origin}/${slug}/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    return keepPrefix(await assetAt(env, req, rest), `/${slug}`, url);
  }
  // Tarjeta de un profesional: /<slug>/<handle>[/manifest.webmanifest | /sw.js]
  const [, handle, extra = ''] = rest.split('/');
  if (isValidHandle(handle) && ['', 'manifest.webmanifest', 'sw.js'].includes(extra)) {
    const data = await memberCardData(env, slug, handle);
    if (!data) throw notFound('No encontramos esta tarjeta.');
    if (extra === 'manifest.webmanifest') return manifest(memberCardInfo(data));
    if (extra === 'sw.js') return serviceWorker(`/${data.path}`);
    return cardPage(env, url, memberCardInfo(data));
  }
  throw notFound();
}

// /admin/… sin consultorio: se lleva al consultorio de donde viene (Referer) o al del usuario.
async function handleLegacyAdmin(req, env, url) {
  if (url.pathname.startsWith('/admin/assets/')) return env.ASSETS.fetch(req);
  let slug = null;
  const ref = req.headers.get('referer');
  if (ref) {
    try {
      const r = new URL(ref);
      const s = r.origin === url.origin && slugFromPath(r.pathname);
      if (s && (r.pathname === `/${s}/admin` || r.pathname.startsWith(`/${s}/admin/`))) slug = s;
    } catch { /* Referer inválido */ }
  }
  const session = await loadSession(req, env);
  // Con sesión, solo se sigue al consultorio de origen si la persona es miembro (evita bucles).
  if (slug && session && !(await isMember(env, session.user_id, slug))) slug = null;
  if (!slug && session) slug = await defaultSlug(env, session);
  if (slug) return Response.redirect(`${url.origin}/${slug}${url.pathname}${url.search}`, 302);
  if (!session) {
    // El login genérico vive en la raíz "/". /admin/login (links viejos, también con #invite=…)
    // redirige ahí: el navegador conserva el fragmento.
    const isLogin = /^\/admin\/login(\.html)?$/.test(url.pathname);
    const isHome = /^\/admin\/?$/.test(url.pathname);
    const next = isLogin ? url.search : isHome ? '' : `?next=${encodeURIComponent(url.pathname + url.search)}`;
    return Response.redirect(`${url.origin}/${next}`, 302);
  }
  return env.ASSETS.fetch(req);  // sesión sin consultorios
}

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

const worker = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const isApi = url.pathname.startsWith('/api/');
    try {
      if (isApi) return withHeaders(await handleApi(req, env, ctx, url), SECURITY_HEADERS);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        return withHeaders(await handleLegacyAdmin(req, env, url), SECURITY_HEADERS);
      }
      // Raíz: login genérico (sin consultorio en la URL). Con sesión, directo a su consultorio.
      if (url.pathname === '/') {
        const session = await loadSession(req, env);
        if (session) {
          const s = await defaultSlug(env, session);
          return Response.redirect(`${url.origin}${s ? `/${s}` : ''}/admin/`, 302);
        }
        return withHeaders(await assetAt(env, req, '/admin/login'), SECURITY_HEADERS);
      }
      const slug = slugFromPath(url.pathname);
      if (slug) return withHeaders(await handleBusinessPath(req, env, url, slug), SECURITY_HEADERS);
      return env.ASSETS.fetch(req);
    } catch (err) {
      if (isApi) return errorResponse(err);
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      const msg = err instanceof HttpError ? err.message : 'Error interno';
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Acceso</title><body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">` +
          `<h1 style="font-size:1.25rem">${status === 404 ? 'Página no encontrada' : 'No se pudo abrir la página'}</h1><p>${msg.replace(/[<>&]/g, '')}</p></body>`,
        { status, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } },
      );
    }
  },
};
export default worker;

// Diwilo Web administra esta app por RPC (service binding con entrypoint "Platform"), sin clave compartida.
export class Platform extends WorkerEntrypoint {
  call(method, path, body, origin) {
    return platformCall(worker, this.env, this.ctx, method, path, body, origin);
  }
}
