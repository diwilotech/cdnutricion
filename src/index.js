// CD Nutrición — Worker monolítico: API + panel admin (HTML estáticos).
import { Router } from './router.js';
import { HttpError, errorResponse } from './lib/http.js';
import { authenticate, accessEmail, loadSession } from './lib/auth.js';
import * as authApi from './api/auth.js';
import * as dashboardApi from './api/dashboard.js';
import * as patientsApi from './api/patients.js';
import * as appointmentsApi from './api/appointments.js';
import * as filesApi from './api/files.js';
import * as businessApi from './api/business.js';
import * as superApi from './api/super.js';

const router = new Router();
for (const mod of [authApi, dashboardApi, patientsApi, appointmentsApi, filesApi, businessApi, superApi]) {
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
  if (req.method !== 'GET' && req.headers.get('x-cdn') !== '1') {
    throw new HttpError(403, 'Solicitud no permitida');
  }
  const c = { req, env, ctx, url, params };
  await authenticate(c, route.auth);
  return route.handler(c);
}

// Páginas /admin/*: Access siempre; sin sesión (PIN) se redirige al login.
async function handleAdminPage(req, env, url) {
  const page = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/admin';
  const isPublicAsset = page === '/admin/login' || url.pathname.startsWith('/admin/assets/');

  let email;
  try {
    email = await accessEmail(req, env);
  } catch (e) {
    if (isPublicAsset && url.pathname.startsWith('/admin/assets/')) return env.ASSETS.fetch(req);
    throw e;
  }
  if (!isPublicAsset) {
    const session = await loadSession(req, env, email);
    if (!session) {
      const next = encodeURIComponent(url.pathname + url.search);
      return Response.redirect(`${url.origin}/admin/login?next=${next}`, 302);
    }
    if (page === '/admin/negocios' && !session.is_superadmin) {
      return Response.redirect(`${url.origin}/admin/`, 302);
    }
  }
  return env.ASSETS.fetch(req);
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
        return withHeaders(await handleAdminPage(req, env, url), SECURITY_HEADERS);
      }
      if (url.pathname === '/') return Response.redirect(`${url.origin}/admin/`, 302);
      return env.ASSETS.fetch(req);
    } catch (err) {
      if (isApi) return errorResponse(err);
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      const msg = err instanceof HttpError ? err.message : 'Error interno';
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Acceso</title><body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">` +
          `<h1 style="font-size:1.25rem">No se pudo abrir el panel</h1><p>${msg.replace(/[<>&]/g, '')}</p></body>`,
        { status, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } },
      );
    }
  },
};
