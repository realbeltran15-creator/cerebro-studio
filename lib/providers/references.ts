import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadObject } from '@/lib/storage/server'

/**
 * Reference images for consistent characters. Only the caller's own image assets can be used
 * (ownership is checked by owner_id and again by the storage path), and they are fetched on the
 * server so no signed URL or provider key ever reaches the browser.
 */
export type ReferenceImage = { assetId: string; bytes: Buffer; mime: string }

export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024
const IMAGE_MIME = /^image\/(png|jpeg|webp)$/

export async function loadReferenceImages(db: SupabaseClient, ownerId: string, projectId: string, assetIds: string[], max: number): Promise<ReferenceImage[]> {
  const ids = [...new Set(assetIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)))]
  if (!ids.length) return []
  if (ids.length > max) throw new Error(`Este modelo admite ${max} imágenes de referencia como máximo.`)
  const { data, error } = await db.from('assets').select('id,asset_type,storage_path,project_id,provenance')
    .eq('owner_id', ownerId).eq('project_id', projectId).in('id', ids).in('asset_type', ['image', 'thumbnail'])
  if (error) throw new Error('No se pudieron leer las referencias.')
  const byId = new Map((data ?? []).map(a => [a.id as string, a]))
  const out: ReferenceImage[] = []
  for (const id of ids) {
    const a = byId.get(id)
    if (!a?.storage_path) throw new Error('Una de las referencias no existe en este proyecto.')
    const blob = await downloadObject(db, ownerId, a.storage_path as string)
    if (blob.size > MAX_REFERENCE_BYTES) throw new Error('Una referencia supera 12 MB.')
    const mime = blob.type || String((a.provenance as Record<string, unknown> | null)?.mimeType ?? '')
    if (!IMAGE_MIME.test(mime)) throw new Error('Solo se admiten referencias PNG, JPEG o WebP.')
    out.push({ assetId: id, bytes: Buffer.from(await blob.arrayBuffer()), mime })
  }
  return out
}

/** Shrinks a reference so its longest side is at most `maxSide` px (Cloudflare FLUX.2 takes inputs of up to 512×512). */
export async function shrinkReference(ref: ReferenceImage, maxSide: number): Promise<ReferenceImage> {
  type Sharp = (input: Buffer) => { rotate(): { resize(o: object): { jpeg(o: object): { toBuffer(): Promise<Buffer> } } } }
  let sharp: Sharp
  try {
    const mod = await import('sharp') as unknown as { default?: Sharp }
    sharp = (mod.default ?? (mod as unknown as Sharp))
  } catch { throw new Error('No se pudo reducir la referencia: falta el módulo de imágenes en el servidor.') }
  const bytes = await sharp(ref.bytes).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  return { assetId: ref.assetId, bytes, mime: 'image/jpeg' }
}

/** Marker stored in an asset's provenance so it can be offered as a reference later. */
export type CharacterMark = { role: 'character_reference'; characterName: string; characterIdentity: string | null }
export const isCharacterReference = (p: Record<string, unknown> | null | undefined) => p?.role === 'character_reference'
