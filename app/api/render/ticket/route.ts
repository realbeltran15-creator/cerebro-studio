import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { signedReadUrl } from '@/lib/storage/server'
import { parseComposition } from '@/lib/editor/composition'
import { ticketAssetIds, ticketKind, TICKET_TTL_S, type RenderTicket } from '@/lib/render/ticket'

export const dynamic = 'force-dynamic'

/**
 * POST { jobId } → a render ticket for the person's own montage (their render_jobs row): the montage plus signed links to its materials.
 * Nothing is rendered here and nothing is written; the offline renderer (`node scripts/render.mjs ticket paquete.json --out video.mp4`)
 * downloads the materials and renders on the person's computer.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { jobId?: unknown } | null
  if (!body || typeof body.jobId !== 'string') return NextResponse.json({ error: 'Falta jobId.' }, { status: 400 })
  const { data: job } = await supabase.from('render_jobs').select('id,project_id,composition').eq('id', body.jobId).eq('owner_id', user.id).maybeSingle()
  const composition = job ? parseComposition(job.composition) : null
  if (!job || !composition) return NextResponse.json({ error: 'Montaje no encontrado.' }, { status: 404 })
  const ids = ticketAssetIds(composition)
  const { data: rows } = await supabase.from('assets').select('id,asset_type,storage_path,provenance').in('id', ids).eq('owner_id', user.id)
  const byId = new Map((rows ?? []).map(r => [r.id as string, r]))
  const missing = ids.filter(id => !byId.get(id)?.storage_path)
  if (missing.length) return NextResponse.json({ error: `El montaje usa ${missing.length} recurso(s) que ya no existen o no tienen archivo.`, missing }, { status: 422 })
  const assets: RenderTicket['assets'] = {}
  try {
    for (const id of ids) {
      const r = byId.get(id)!
      const bytes = Number((r.provenance as { bytes?: unknown } | null)?.bytes)
      assets[id] = { url: await signedReadUrl(supabase, user.id, r.storage_path as string, TICKET_TTL_S), kind: ticketKind(String(r.asset_type)), bytes: Number.isFinite(bytes) ? bytes : null }
    }
  } catch {
    return NextResponse.json({ error: 'No se pudieron crear los enlaces de acceso a los materiales.' }, { status: 503 })
  }
  const now = Date.now()
  const ticket: RenderTicket = { version: 1, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TICKET_TTL_S * 1000 - 60_000).toISOString(), jobId: job.id as string, projectId: (job.project_id as string | null) ?? null, title: composition.title, composition, assets }
  return NextResponse.json(ticket, { headers: { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="paquete-render.json"' } })
}
