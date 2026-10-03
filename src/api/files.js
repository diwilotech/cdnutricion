// Fotos y documentos de pacientes en R2. Clave: <business_id>/<patient_id>/<uuid>
import { json, HttpError } from '../lib/http.js';
import { tenantDb, uuid } from '../lib/db.js';
import { getPatient } from './patients.js';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;

export function routes(r) {
  r.post('/api/admin/patients/:id/files', 'tenant', async (c) => {
    const db = tenantDb(c);
    await getPatient(db, c.businessId, c.params.id);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Adjunta un archivo');
    if (file.size > MAX_BYTES) throw new HttpError(413, 'El archivo supera 15 MB');
    if (!ALLOWED.test(file.type)) throw new HttpError(415, 'Solo se permiten imágenes o PDF');

    const id = uuid();
    const key = `${c.businessId}/${c.params.id}/${id}`;
    const name = (file.name || 'archivo').replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120);
    await c.env.FILES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { businessId: c.businessId, patientId: c.params.id, name },
    });
    await db.run(
      `INSERT INTO files (id, business_id, patient_id, r2_key, name, content_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, c.businessId, c.params.id, key, name, file.type, file.size, c.user.id,
    );
    return json({ id, name }, 201);
  });

  r.get('/api/admin/files/:id', 'tenant', async (c) => {
    const f = await tenantDb(c).first('SELECT * FROM files WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    if (!f) throw new HttpError(404, 'Archivo no encontrado');
    const obj = await c.env.FILES.get(f.r2_key);
    if (!obj) throw new HttpError(404, 'Archivo no encontrado en almacenamiento');
    const disposition = c.url.searchParams.get('download') ? 'attachment' : 'inline';
    return new Response(obj.body, {
      headers: {
        'content-type': f.content_type || 'application/octet-stream',
        'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  });

  r.delete('/api/admin/files/:id', 'tenant', async (c) => {
    const db = tenantDb(c);
    const f = await db.first('SELECT r2_key FROM files WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    if (!f) throw new HttpError(404, 'Archivo no encontrado');
    await c.env.FILES.delete(f.r2_key);
    await db.run('DELETE FROM files WHERE business_id = ? AND id = ?', c.businessId, c.params.id);
    return json({ ok: true });
  });
}
