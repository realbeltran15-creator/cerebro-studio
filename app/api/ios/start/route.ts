import { serviceRoleClient } from '@/lib/supabase/admin'
import { BUCKET, SUPABASE_MAX_BYTES, storageDriver } from '@/lib/storage/server'
import { classify, formatBytes } from '@/lib/ingest/files'
import { bearer, ownerOfToken, text } from '@/lib/ingest/shortcut'

export const dynamic = 'force-dynamic'

/**
 * Step 1 of the iPhone shortcut: «I am about to send <name> (<size> bytes)». Answers with a one-time signed upload URL (2 h, this path only)
 * that the shortcut PUTs the original file to — the file goes straight to storage, never through this server.
 * Response (JSON): { putUrl, contentType, path }. Errors are plain text so the shortcut can show them.
 */
export async function POST(request: Request) {
  const admin = serviceRoleClient()
  if (!admin) return text('Cerebro Studio no tiene activada la recepción desde iPhone en este entorno (falta la clave de servidor).', 503)
  const token = bearer(request)
  if (!token) return text('Falta el código del atajo o no es válido. Cópialo de nuevo en Cerebro Studio › Añadir materiales.', 401)
  const owner = await ownerOfToken(admin, token)
  if (!owner) return text('Código del atajo revocado o incorrecto. Genera uno nuevo en Cerebro Studio › Añadir materiales.', 401)
  if (storageDriver() !== 'supabase') return text('El almacenamiento configurado no admite el atajo todavía.', 501)
  const body = await request.json().catch(() => ({})) as { name?: unknown; size?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
  const c = classify(name, '')
  if (!c.ok) return text(`${name || 'Archivo'}: ${c.reason}`, 415)
  const size = Number(body.size)
  if (Number.isFinite(size) && size > SUPABASE_MAX_BYTES) return text(`${name} pesa ${formatBytes(size)} y el almacenamiento admite ${formatBytes(SUPABASE_MAX_BYTES)} por archivo. Recórtalo en Fotos y vuelve a compartirlo.`, 413)
  // Same quota as the browser upload (Supabase Free: 1 GB for the whole project).
  const quota = Math.max(0.1, Number(process.env.STORAGE_QUOTA_GB) || 0.95) * 1024 ** 3
  const { data: rows } = await admin.from('assets').select('bytes:provenance->bytes').eq('owner_id', owner.ownerId).limit(20000)
  const used = (rows ?? []).reduce((a, r) => a + (Number((r as { bytes?: unknown }).bytes) || 0), 0)
  if (used + (Number.isFinite(size) ? size : 0) > quota) return text(`Espacio en la nube lleno (${formatBytes(used)} de ${formatBytes(quota)}). Borra archivos en la Biblioteca de Cerebro Studio.`, 413)
  // The destination is re-checked: a project deleted since the token was created falls back to the general Library.
  let dest = owner.config.destination || 'library'
  if (dest !== 'library') { const { data } = await admin.from('projects').select('id').eq('id', dest).eq('owner_id', owner.ownerId).maybeSingle(); if (!data) dest = 'library' }
  const path = `${owner.ownerId}/${dest}/uploads/ios-${crypto.randomUUID()}.${c.ext}`
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) return text('No se pudo preparar la subida. Inténtalo de nuevo.', 502)
  return Response.json({ putUrl: data.signedUrl, contentType: c.mime, path }, { headers: { 'Cache-Control': 'no-store' } })
}
