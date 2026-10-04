// CD Nutrición — Worker monolítico: API + panel admin (HTML estáticos).
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
import { parseCard, logoUrl } from './api/card.js';

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
  // Diwilo Web (nivel 'platform') no usa cookies: se autentica con PLATFORM_KEY.
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

// HTML de la tarjeta con su título, descripción, foto (vista previa al compartir) y manifiesto.
async function cardPage(env, req, url, business) {
  const slug = business.slug;
  const plain = new URL(url); plain.pathname = '/negocio'; plain.search = '';
  const res = await env.ASSETS.fetch(new Request(plain));  // sin encabezados condicionales: el HTML varía por consultorio
  const card = parseCard(business.card);
  const img = url.origin + (logoUrl(slug, business.logo_key) || '/cv/icon-512.png');
  const desc = card.bio || card.specialty || 'Seguimiento nutricional personalizado';
  const attr = (name, value) => ({ element(e) { e.setAttribute(name, value); } });
  const out = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(business.name); } })
    .on('meta[name="description"]', attr('content', desc))
    .on('meta[property="og:title"]', attr('content', business.name))
    .on('meta[property="og:description"]', attr('content', desc))
    .on('meta[property="og:image"]', attr('content', img))
    .on('meta[property="og:url"]', attr('content', `${url.origin}/${slug}`))
    .on('link[rel="manifest"]', attr('href', `/${slug}/manifest.webmanifest`))
    .on('link[rel="apple-touch-icon"]', attr('href', business.logo_key ? img : '/cv/icon-180.png'))
    .on('meta[name="apple-mobile-web-app-title"]', attr('content', business.name.slice(0, 30)))
    .transform(res);
  const h = new Headers(out.headers);
  h.delete('etag');
  h.set('cache-control', 'no-cache');
  return new Response(out.body, { status: res.status, headers: h });
}

function manifest(url, business) {
  const slug = business.slug;
  const card = parseCard(business.card);
  const logo = logoUrl(slug, business.logo_key);
  const icons = logo
    ? [{ src: logo, sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: logo, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: logo, sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    : [{ src: '/cv/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/cv/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }];
  return new Response(JSON.stringify({
    id: `/${slug}`,
    name: business.name,
    short_name: business.name.length > 24 ? business.name.split(' ')[0].slice(0, 24) : business.name,
    description: card.bio || card.specialty || 'Consultorio de nutrición',
    start_url: `/${slug}?src=app`,
    scope: `/${slug}`,
    display: 'standalone',
    background_color: '#F2F5FA',
    theme_color: THEME,
    lang: 'es',
    icons,
  }), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' } });
}

// Service worker mínimo: guarda la tarjeta para que abra aunque no haya conexión.
function serviceWorker(slug) {
  const js = `const CACHE = 'tarjeta-${slug}-v1', PAGE = '/${slug}';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.add(PAGE))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.mode !== 'navigate' || (u.pathname !== PAGE && u.pathname !== PAGE + '/')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(PAGE, copy)); return r; })
    .catch(() => caches.match(PAGE)));
});`;
  return new Response(js, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'service-worker-allowed': `/${slug}` },
  });
}

// /<slug>, /<slug>/admin/…, /<slug>/p/
async function handleBusinessPath(req, env, url, slug) {
  const rest = url.pathname.slice(slug.length + 1) || '/';
  const business = await businessBySlug(env, slug);
  if (!business || business.status !== 'active') throw notFound('No encontramos este consultorio.');

  if (rest === '/') return cardPage(env, req, url, business);
  if (rest === '/manifest.webmanifest') return manifest(url, business);
  if (rest === '/sw.js') return serviceWorker(slug);
  if (rest === '/p' || rest === '/p/') return assetAt(env, req, '/p/');
  if (rest === '/admin' || rest.startsWith('/admin/')) {
    if (rest.startsWith('/admin/assets/')) return assetAt(env, req, rest);
    const page = rest.replace(/\.html$/, '').replace(/\/$/, '');
    if (page !== '/admin/login' && !(await loadSession(req, env))) {
      return Response.redirect(`${url.origin}/${slug}/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    return keepPrefix(await assetAt(env, req, rest), `/${slug}`, url);
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
  const isLogin = /^\/admin\/login(\.html)?$/.test(url.pathname);
  if (!isLogin && !session) {
    return Response.redirect(`${url.origin}/admin/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }
  return env.ASSETS.fetch(req);  // login genérico, o sesión sin consultorios
}

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const isApi = url.pathname.startsWith('/api/');
    try {
      if (isApi) return withHeaders(await handleApi(req, env, ctx, url), SECURITY_HEADERS);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        return withHeaders(await handleLegacyAdmin(req, env, url), SECURITY_HEADERS);
      }
      if (url.pathname === '/') return Response.redirect(`${url.origin}/admin/`, 302);
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
