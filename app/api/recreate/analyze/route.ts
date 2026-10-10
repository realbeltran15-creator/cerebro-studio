import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { analyseReference, createPlan, publicAnalysis, RecreateError } from '@/lib/recreate/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Reference video (URL or pasted transcript) → analysis + an ORIGINAL plan with the same structure.
 * Nothing is generated or spent here beyond text from free-tier providers, and nothing is saved until /save.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { projectId?: string; url?: string; transcript?: string; idea?: string; consistent?: boolean } | null
  const projectId = body?.projectId?.trim()
  if (!projectId) return NextResponse.json({ error: 'projectId es obligatorio.' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })
  const requestId = crypto.randomUUID()
  try {
    const ref = await analyseReference({ url: body?.url, transcript: body?.transcript, requestId })
    const made = await createPlan(ref.analysis, { idea: body?.idea, consistent: body?.consistent === true, requestId })
    return NextResponse.json({ analysis: publicAnalysis(ref.analysis), via: ref.via, source: ref.source, plan: made.plan, originality: made.originality, textModel: made.model })
  } catch (e) {
    if (e instanceof RecreateError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    console.error('recreate-analyze', requestId, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo analizar el vídeo.' }, { status: 502 })
  }
}
