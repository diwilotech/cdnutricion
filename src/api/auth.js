import { json, readJson, HttpError } from '../lib/http.js';
import {
  loadUser, loadSession, userBusinesses, checkPin, setPin,
  createSession, sessionCookie, destroySession,
} from '../lib/auth.js';
import { globalDb } from '../lib/db.js';

export function routes(r) {
  // Estado de la identidad: lo usa login.html y el encabezado de cada página.
  r.get('/api/admin/auth/me', 'access', async (c) => {
    const user = c.user;
    const session = await loadSession(c.req, c.env, c.email);
    return json({
      userId: user.id,
      email: c.email,
      name: user.name,
      hasPin: !!user.pin_hash,
      isSuperadmin: !!user.is_superadmin,
      session: session
        ? { businessId: session.business_id, businessName: session.business_name, role: session.role }
        : null,
      businesses: session ? await userBusinesses(c.env, user) : [],
    });
  });

  // Valida (o define por primera vez) el PIN y abre sesión.
  r.post('/api/admin/auth/pin', 'access', async (c) => {
    const { pin, name } = await readJson(c.req);
    const user = c.user;
    if (!user.pin_hash) {
      await setPin(c.env, user.id, String(pin || ''));
      if (name) await globalDb(c.env).run('UPDATE users SET name = ? WHERE id = ?', String(name).slice(0, 100), user.id);
    } else {
      if (!/^\d{4,8}$/.test(String(pin || ''))) throw new HttpError(400, 'PIN inválido');
      await checkPin(c.env, user, String(pin));
    }
    const businesses = await userBusinesses(c.env, user);
    const active = businesses.filter((b) => b.status === 'active');
    const businessId = active.length === 1 ? active[0].id : null;
    const token = await createSession(c.env, user, businessId);
    return json(
      { ok: true, businessId, businesses },
      200,
      { 'set-cookie': sessionCookie(token, c.req) },
    );
  });

  // Cambia el negocio activo de la sesión.
  r.post('/api/admin/auth/business', 'session', async (c) => {
    const { businessId } = await readJson(c.req);
    const allowed = await userBusinesses(c.env, c.user);
    const b = allowed.find((x) => x.id === businessId);
    if (!b) throw new HttpError(403, 'No perteneces a ese negocio');
    await globalDb(c.env).run('UPDATE sessions SET business_id = ? WHERE id = ?', b.id, c.session.session_id);
    return json({ ok: true, businessId: b.id, businessName: b.name });
  });

  r.post('/api/admin/auth/change-pin', 'session', async (c) => {
    const { currentPin, newPin } = await readJson(c.req);
    const user = await loadUser(c.env, c.email);
    await checkPin(c.env, user, String(currentPin || ''));
    await setPin(c.env, user.id, String(newPin || ''));
    return json({ ok: true });
  });

  r.post('/api/admin/auth/logout', 'session', async (c) => {
    await destroySession(c.env, c.session.session_id);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(null, c.req) });
  });
}
