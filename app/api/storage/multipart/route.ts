import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkQuota } from '@/lib/storage/quota'
import { abortMultipart, completeMultipart, createMultipart, listParts, MAX_PARTS, partCount, PART_BYTES, partUrl } from '@/lib/storage/multipart'
import { assertOwnPath, isR2Path, r2Configured, r2Key, R2_PREFIX } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

/**
 * Resumable uploads to R2. The browser asks; the server (which alone holds the keys) creates the upload, signs each part's URL, lists the
 * parts already received, completes or aborts. Every call is checked against the caller's own folder.
 *   create   { storagePath, contentType, size }  → { uploadId, partBytes, parts }
 *   status   { storagePath, uploadId }           → { done: [{ partNumber, etag, size }] }   (404 when the upload no longer exists)
 *   part-url { storagePath, uploadId, partNumber, bytes } → { url }
 *   complete { storagePath, uploadId, parts }    → { ok }
 *   abort    { storagePath, uploadId }           → { ok }
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!r2Configured()) return NextResponse.json({ error: 'Cloudflare R2 no está configurado.' }, { status: 409 })
  const b = await request.json().catch(() => ({})) as { action?: string; storagePath?: string; uploadId?: string; contentType?: string; size?: number; partNumber?: number; bytes?: number; parts?: Array<{ partNumber: number; etag: string }> }
  const path = b.storagePath ?? ''
  if (!isR2Path(path)) return NextResponse.json({ error: 'Ruta no válida.' }, { status: 400 })
  try { assertOwnPath(path, user.id) } catch { return NextResponse.json({ error: 'Archivo no válido para este usuario.' }, { status: 403 }) }
  const key = r2Key(path)
  const uploadId = typeof b.uploadId === 'string' && /^[\w.~+/=:-]{8,2048}$/.test(b.uploadId) ? b.uploadId : ''
  const noCache = { 'Cache-Control': 'no-store' }
  try {
    if (b.action === 'create') {
      const size = Math.max(0, Number(b.size) || 0)
      if (!size || partCount(size) > MAX_PARTS) return NextResponse.json({ error: 'Tamaño de archivo no válido.' }, { status: 400 })
      const q = await checkQuota(supabase, user.id, size)
      if (!q.ok) return NextResponse.json({ error: q.error, usedBytes: q.usedBytes, quotaBytes: q.quotaBytes }, { status: 413 })
      const contentType = /^[a-z]+\/[a-z0-9.+-]+$/i.test(b.contentType ?? '') ? b.contentType! : 'application/octet-stream'
      return NextResponse.json({ uploadId: await createMultipart(user.id, key, contentType), partBytes: PART_BYTES, parts: partCount(size), storagePath: `${R2_PREFIX}${key}` }, { headers: noCache })
    }
    if (!uploadId) return NextResponse.json({ error: 'Falta la subida.' }, { status: 400 })
    if (b.action === 'status') {
      try { return NextResponse.json({ done: await listParts(user.id, key, uploadId) }, { headers: noCache }) }
      catch (e) { if (e instanceof Error && e.message === 'NoSuchUpload') return NextResponse.json({ error: 'La subida ya no existe.' }, { status: 404 }); throw e }
    }
    if (b.action === 'part-url') return NextResponse.json({ url: partUrl(user.id, key, uploadId, Number(b.partNumber), Number(b.bytes)) }, { headers: noCache })
    if (b.action === 'complete') {
      const parts = (b.parts ?? []).filter(p => Number.isInteger(p.partNumber) && typeof p.etag === 'string' && p.etag.length < 200)
      await completeMultipart(user.id, key, uploadId, parts)
      return NextResponse.json({ ok: true }, { headers: noCache })
    }
    if (b.action === 'abort') { await abortMultipart(user.id, key, uploadId); return NextResponse.json({ ok: true }, { headers: noCache }) }
    return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en la subida.' }, { status: 502 }) }
}
