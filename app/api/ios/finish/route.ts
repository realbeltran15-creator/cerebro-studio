import { serviceRoleClient } from '@/lib/supabase/admin'
import { BUCKET } from '@/lib/storage/server'
import { classify, fingerprintKey, formatBytes } from '@/lib/ingest/files'
import { bearer, ownerOfToken, shortcutPathOk, text } from '@/lib/ingest/shortcut'

export const dynamic = 'force-dynamic'

/**
 * Step 2 of the iPhone shortcut: the file was PUT to storage; check it really arrived (size and type read from storage), skip duplicates
 * (same name and size already in the account: the new copy is removed) and register it in the chosen destination. Answers plain text.
 */
export async function POST(request: Request) {
  const admin = serviceRoleClient()
  if (!admin) return text('Recepción desde iPhone no activada en este entorno.', 503)
  const token = bearer(request)
  const owner = token ? await ownerOfToken(admin, token) : null
  if (!owner) return text('Código del atajo revocado o incorrecto.', 401)
  const body = await request.json().catch(() => ({})) as { path?: unknown; name?: unknown }
  const path = typeof body.path === 'string' ? body.path : ''
  const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : path.split('/').pop() ?? 'archivo').slice(0, 200)
  if (!shortcutPathOk(path, owner.ownerId)) return text('Ruta de subida no válida.', 400)
  const dir = path.slice(0, path.lastIndexOf('/')), file = path.slice(path.lastIndexOf('/') + 1)
  const { data: listed } = await admin.storage.from(BUCKET).list(dir, { search: file, limit: 1 })
  const obj = listed?.find(o => o.name === file) as { metadata?: { size?: number; mimetype?: string } } | undefined
  if (!obj) return text(`${name} no llegó a la nube. Vuelve a compartirlo.`, 404)
  const bytes = Number(obj.metadata?.size) || 0
  const c = classify(name, obj.metadata?.mimetype ?? '')
  if (!c.ok) { await admin.storage.from(BUCKET).remove([path]); return text(`${name}: ${c.reason}`, 415) }
  const key = fingerprintKey(name, bytes)
  const { data: dup } = await admin.from('assets').select('id').eq('owner_id', owner.ownerId).eq('provenance->>fingerprintKey', key).limit(1)
  if (dup?.length) { await admin.storage.from(BUCKET).remove([path]); return text(`Ya estaba en tu Biblioteca: ${name}. No se ha duplicado.`) }
  const dest = path.split('/')[1]
  const { error } = await admin.from('assets').insert({
    owner_id: owner.ownerId, project_id: dest === 'library' ? null : dest, asset_type: c.kind, storage_path: path, source_provider: 'upload', license_status: 'owned',
    provenance: { title: name.replace(/\.[^.]+$/, '').slice(0, 160) || name, originalFilename: name, mimeType: c.mime, bytes, durationSeconds: null, fingerprintKey: key, uploadedAt: new Date().toISOString(), uploadedFrom: 'iphone-shortcut', original: true, ...(c.note ? { note: c.note } : {}) },
  })
  if (error) { await admin.storage.from(BUCKET).remove([path]); return text(`No se pudo registrar ${name}: ${error.message}`, 500) }
  await admin.from('connector_configs').update({ config: { ...owner.config, lastUsedAt: new Date().toISOString(), uploads: (owner.config.uploads ?? 0) + 1 } }).eq('id', owner.rowId)
  return text(`Guardado en Cerebro Studio: ${name} (${formatBytes(bytes)}) en ${dest === 'library' ? 'la Biblioteca general' : 'tu proyecto'}.`)
}
