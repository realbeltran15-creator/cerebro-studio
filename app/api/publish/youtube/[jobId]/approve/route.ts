import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { approvalKeyFor, validatePayload, type PublicationJob } from '@/lib/publication/youtube'

export const dynamic = 'force-dynamic'

/** Records the owner's explicit approval for one publication job. Does not publish anything. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { confirm?: string; riskSummary?: string }
  if (body.confirm !== 'APROBAR') return NextResponse.json({ error: 'Falta la confirmación explícita.' }, { status: 400 })

  const { data } = await supabase.from('publication_jobs').select('id,owner_id,project_id,platform,status,idempotency_key,payload,result').eq('id', jobId).eq('owner_id', user.id).maybeSingle()
  const job = data as PublicationJob | null
  if (!job || job.platform !== 'youtube') return NextResponse.json({ error: 'Trabajo no encontrado.' }, { status: 404 })
  if (!['draft', 'awaiting_approval'].includes(job.status)) return NextResponse.json({ error: 'Este trabajo ya fue aprobado o publicado.' }, { status: 409 })
  const problem = validatePayload(job.payload)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // Licenses of the video inputs: unverified or restricted material blocks the approval.
  const { data: video } = await supabase.from('assets').select('license_status,provenance').eq('id', job.payload.videoAssetId!).eq('owner_id', user.id).maybeSingle()
  const v = video as { license_status: string; provenance: Record<string, unknown> | null } | null
  if (!v) return NextResponse.json({ error: 'El vídeo elegido ya no existe.' }, { status: 404 })
  const inputs = Array.isArray(v.provenance?.inputs) ? v.provenance.inputs as Array<{ license?: string }> : []
  if (['unknown', 'restricted'].includes(v.license_status) || inputs.some(i => i.license === 'unknown' || i.license === 'restricted')) {
    return NextResponse.json({ error: 'El vídeo contiene material con licencia sin verificar o restringida. Revísalo antes de aprobar.' }, { status: 409 })
  }

  const key = approvalKeyFor(job)
  const now = new Date().toISOString()
  const { error: approvalError } = await supabase.from('approvals').upsert({
    owner_id: user.id, action_type: 'publish', entity_type: 'publication_job', entity_id: key, status: 'approved',
    risk_summary: (body.riskSummary ?? '').slice(0, 1000) || null, decided_at: now,
  }, { onConflict: 'owner_id,action_type,entity_type,entity_id,status' })
  if (approvalError) return NextResponse.json({ error: approvalError.message }, { status: 500 })
  const { error } = await supabase.from('publication_jobs').update({ status: 'approved', approved_at: now, approved_by: user.id, updated_at: now }).eq('id', job.id).eq('owner_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ approved: true })
}
