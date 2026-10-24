import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { r2Url, R2_PREFIX, R2_SINGLE_PUT_MAX, storageDriver, SUPABASE_MAX_BYTES } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

const folders = ['renders', 'uploads', 'subtitles', 'auto-edit'] as const

/** Where the browser should upload a new file: a presigned R2 PUT URL, or the Supabase path. */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { projectId?: string; folder?: string; ext?: string; name?: string; contentType?: string; size?: number }
  // «library» = the general Library (no project): files go under <user>/library/ and their asset row has no project.
  const library = body.projectId === 'library'
  if (!library && (!body.projectId || !/^[0-9a-f-]{36}$/i.test(body.projectId))) return NextResponse.json({ error: 'Proyecto no válido.' }, { status: 400 })
  if (!folders.includes(body.folder as typeof folders[number])) return NextResponse.json({ error: 'Carpeta no válida.' }, { status: 400 })
  const ext = (body.ext ?? '').toLowerCase()
  if (!/^[a-z0-9]{2,5}$/.test(ext)) return NextResponse.json({ error: 'Extensión no válida.' }, { status: 400 })
  const contentType = (body.contentType ?? 'application/octet-stream').trim()
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(contentType)) return NextResponse.json({ error: 'Tipo de archivo no válido.' }, { status: 400 })
  if (!library) {
    const { data: project } = await supabase.from('projects').select('id').eq('id', body.projectId).eq('owner_id', user.id).maybeSingle()
    if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })
  }
  // Quota: keeps the account inside the free storage allowance (R2 free tier is 10 GB-month). Sizes come from asset provenance.
  // Default: R2 free tier ≈ 9 GB of its 10; Supabase Free = 1 GB in total for the whole project (0.95 to leave room for the database's own files).
  const quotaBytes = Math.max(0.1, Number(process.env.STORAGE_QUOTA_GB) || (storageDriver() === 'r2' ? 9 : 0.95)) * 1024 ** 3
  const { data: rows } = await supabase.from('assets').select('bytes:provenance->bytes').eq('owner_id', user.id).limit(20000)
  const used = (rows ?? []).reduce((a, r) => a + (Number((r as { bytes?: unknown }).bytes) || 0), 0)
  const incoming = Math.max(0, Number(body.size) || 0)
  if (used + incoming > quotaBytes) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
    return NextResponse.json({ error: `Espacio en la nube lleno: usas ${gb(used)} GB de ${gb(quotaBytes)} GB. Borra archivos que no necesites en la Biblioteca o sube el límite (STORAGE_QUOTA_GB).`, usedBytes: used, quotaBytes }, { status: 413 })
  }
  const name = /^[A-Za-z0-9-]{8,64}$/.test(body.name ?? '') ? body.name : crypto.randomUUID()
  const key = `${user.id}/${library ? 'library' : body.projectId}/${body.folder}/${name}.${ext}`
  if (storageDriver() === 'r2') {
    // Only asking for the limits (size 0): no upload link. A real upload link is bound to the declared type AND size.
    if (incoming <= 0) return NextResponse.json({ driver: 'r2', maxBytes: R2_SINGLE_PUT_MAX }, { headers: { 'Cache-Control': 'no-store' } })
    if (incoming > R2_SINGLE_PUT_MAX) return NextResponse.json({ error: 'El archivo pasa de 5 GB, el máximo de una sola subida.' }, { status: 413 })
    return NextResponse.json({ driver: 'r2', storagePath: `${R2_PREFIX}${key}`, uploadUrl: r2Url('PUT', key, 900, contentType, incoming), contentType, maxBytes: R2_SINGLE_PUT_MAX }, { headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ driver: 'supabase', storagePath: key, maxBytes: SUPABASE_MAX_BYTES, resumable: true }, { headers: { 'Cache-Control': 'no-store' } })
}
