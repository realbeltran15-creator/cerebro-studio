import { NextResponse } from 'next/server'
import { approvalBlockers } from '@/lib/shorts/approval'
import { requireUser } from '@/lib/shorts/server'

export const dynamic = 'force-dynamic'

const PROJECT_NAME = 'Umbral del Hito · Shorts'

/** Modo A: Jesús aprueba o rechaza cada Short. La aprobación se registra con su sesión (RLS), nunca con service role. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const { supabase, user } = auth
  const body = await request.json().catch(() => ({})) as { decision?: string; note?: string; confirmations?: { sources?: boolean; hook?: boolean } }

  const { data: short } = await supabase.from('shorts').select('id,status,title,description,tags,facts,quality,discard_detail,project_id,topic').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!short) return NextResponse.json({ error: 'Short no encontrado' }, { status: 404 })

  if (body.decision === 'reject') {
    if (short.status !== 'ready_for_approval') return NextResponse.json({ error: `No se puede rechazar en estado ${short.status}` }, { status: 409 })
    await supabase.from('shorts').update({ status: 'rejected', discard_detail: { ...(short.discard_detail ?? {}), rejection_note: String(body.note ?? '').slice(0, 500) }, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id)
    await supabase.from('approvals').insert({ owner_id: user.id, action_type: 'publish', entity_type: 'short', entity_id: id, status: 'rejected', risk_summary: String(body.note ?? '').slice(0, 500) || null, decided_at: new Date().toISOString() })
    return NextResponse.json({ status: 'rejected' })
  }
  if (body.decision !== 'approve') return NextResponse.json({ error: 'decision debe ser approve o reject' }, { status: 400 })

  const blockers = approvalBlockers(short, body.confirmations ?? {})
  if (blockers.length) return NextResponse.json({ error: 'No se puede aprobar', blockers }, { status: 422 })

  // publication_jobs exige project_id: se reutiliza (o crea) un proyecto para los Shorts.
  let projectId = short.project_id as string | null
  if (!projectId) {
    const { data: existing } = await supabase.from('projects').select('id').eq('owner_id', user.id).eq('name', PROJECT_NAME).limit(1).maybeSingle()
    projectId = existing?.id ?? (await supabase.from('projects').insert({ owner_id: user.id, name: PROJECT_NAME, description: 'Shorts de curiosidades generados por la Fábrica de Shorts', status: 'production', target_platforms: ['youtube'] }).select('id').single()).data?.id ?? null
  }
  if (!projectId) return NextResponse.json({ error: 'No se pudo preparar el proyecto de Shorts' }, { status: 500 })

  const now = new Date().toISOString()
  const payload = { title: short.title, privacy: 'private', contains_synthetic_media: true, short_id: id }
  const { data: job, error: jobError } = await supabase.from('publication_jobs').upsert({
    owner_id: user.id, project_id: projectId, platform: 'youtube', status: 'approved', approved_at: now, approved_by: user.id,
    idempotency_key: `short:${id}`, payload,
  }, { onConflict: 'idempotency_key' }).select('id').single()
  if (jobError || !job) return NextResponse.json({ error: jobError?.message ?? 'No se pudo crear el trabajo de publicación' }, { status: 500 })

  const { error: approvalError } = await supabase.from('approvals').insert({
    owner_id: user.id, action_type: 'publish', entity_type: 'short', entity_id: id, status: 'approved', decided_at: now,
    risk_summary: 'Subida como PRIVADO con contenido sintético declarado. Hacerlo público es una acción manual posterior en YouTube Studio.',
  })
  if (approvalError) return NextResponse.json({ error: approvalError.message }, { status: 500 })

  await supabase.from('shorts').update({ status: 'approved', project_id: projectId, publication_job_id: job.id, updated_at: now }).eq('id', id).eq('owner_id', user.id)
  return NextResponse.json({ status: 'approved' })
}
