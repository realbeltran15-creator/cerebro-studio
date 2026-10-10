import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { r2Url, R2_PREFIX, storageDriver } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

const folders = ['renders', 'uploads', 'subtitles', 'auto-edit'] as const

/** Where the browser should upload a new file: a presigned R2 PUT URL, or the Supabase path. */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { projectId?: string; folder?: string; ext?: string; name?: string; contentType?: string; size?: number }
  if (!body.projectId || !/^[0-9a-f-]{36}$/i.test(body.projectId)) return NextResponse.json({ error: 'Proyecto no válido.' }, { status: 400 })
  if (!folders.includes(body.folder as typeof folders[number])) return NextResponse.json({ error: 'Carpeta no válida.' }, { status: 400 })
  const ext = (body.ext ?? '').toLowerCase()
  if (!/^[a-z0-9]{2,5}$/.test(ext)) return NextResponse.json({ error: 'Extensión no válida.' }, { status: 400 })
  const contentType = (body.contentType ?? 'application/octet-stream').trim()
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(contentType)) return NextResponse.json({ error: 'Tipo de archivo no válido.' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', body.projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })
  // Quota: keeps the account inside the free storage allowance (R2 free tier is 10 GB-month). Sizes come from asset provenance.
  const quotaBytes = Math.max(0.1, Number(process.env.STORAGE_QUOTA_GB) || 9) * 1024 ** 3
  const { data: rows } = await supabase.from('assets').select('bytes:provenance->bytes').eq('owner_id', user.id).limit(20000)
  const used = (rows ?? []).reduce((a, r) => a + (Number((r as { bytes?: unknown }).bytes) || 0), 0)
  const incoming = Math.max(0, Number(body.size) || 0)
  if (used + incoming > quotaBytes) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
    return NextResponse.json({ error: `Espacio en la nube lleno: usas ${gb(used)} GB de ${gb(quotaBytes)} GB. Borra archivos que no necesites en la Biblioteca o sube el límite (STORAGE_QUOTA_GB).`, usedBytes: used, quotaBytes }, { status: 413 })
  }
  const name = /^[A-Za-z0-9-]{8,64}$/.test(body.name ?? '') ? body.name : crypto.randomUUID()
  const key = `${user.id}/${body.projectId}/${body.folder}/${name}.${ext}`
  if (storageDriver() === 'r2') return NextResponse.json({ driver: 'r2', storagePath: `${R2_PREFIX}${key}`, uploadUrl: r2Url('PUT', key, 900, contentType), contentType }, { headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ driver: 'supabase', storagePath: key, maxBytes: 50 * 1024 * 1024 }, { headers: { 'Cache-Control': 'no-store' } })
}
