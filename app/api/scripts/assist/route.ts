import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { proposeScript, textConfigured, textModel, TextProviderError, type ScriptAssistMode } from '@/lib/providers/openai-text'
import { normalizeSections } from '@/lib/scripts'

export const dynamic = 'force-dynamic'

type Body = {
  projectId?: string
  scriptId?: string
  mode?: ScriptAssistMode
  draft?: { title?: string; idea?: string | null; brief?: string | null; hook?: string | null; cta?: string | null; sections?: unknown }
}

const urlPattern = /https?:\/\/[^\s)\]}>"']+/g
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : null)

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!textConfigured()) {
    return NextResponse.json({ error: 'La asistencia IA necesita OPENAI_TEXT_API_KEY u OPENAI_API_KEY en el servidor.', configured: false }, { status: 503 })
  }

  const body = await request.json().catch(() => null) as Body | null
  const mode: ScriptAssistMode | null = body?.mode === 'hook' || body?.mode === 'draft' ? body.mode : null
  const projectId = body?.projectId?.trim(), scriptId = body?.scriptId?.trim()
  if (!mode || !projectId || !scriptId || !body?.draft) return NextResponse.json({ error: 'projectId, scriptId, mode y draft son obligatorios.' }, { status: 400 })

  const [{ data: project }, { data: script }, { data: opps }] = await Promise.all([
    supabase.from('projects').select('id,name,description').eq('id', projectId).eq('owner_id', user.id).maybeSingle(),
    supabase.from('scripts').select('id').eq('id', scriptId).eq('project_id', projectId).eq('owner_id', user.id).maybeSingle(),
    supabase.from('opportunities').select('title,source_id,evidence').eq('project_id', projectId).eq('owner_id', user.id).limit(20),
  ])
  if (!project || !script) return NextResponse.json({ error: 'Guion no encontrado.' }, { status: 404 })

  const sections = normalizeSections(body.draft.sections).slice(0, 20).map(s => ({ heading: s.heading.slice(0, 120), basis: s.basis, text: s.text.slice(0, 6000), sources: s.sources.slice(0, 10) }))
  const brief = text(body.draft.brief, 8000)

  // Sources the model may cite: only what the user already has in this project.
  const allowed = new Set<string>()
  const research = (opps ?? []).map(o => {
    const notes: string[] = []
    if (o.source_id && /^https?:\/\//.test(o.source_id)) allowed.add(o.source_id)
    if (Array.isArray(o.evidence)) for (const ev of o.evidence as Array<Record<string, unknown>>) {
      if (ev && typeof ev.url === 'string' && /^https?:\/\//.test(ev.url)) allowed.add(ev.url)
      if (ev && typeof ev.note === 'string' && ev.note.trim()) notes.push(ev.note.trim().slice(0, 500))
    }
    return { title: o.title, source: o.source_id, notes }
  })
  for (const s of sections) for (const src of s.sources) allowed.add(src)
  for (const match of brief?.match(urlPattern) ?? []) allowed.add(match)

  const requestId = crypto.randomUUID()
  try {
    const proposal = await proposeScript({
      mode, projectName: project.name, projectDescription: project.description,
      title: text(body.draft.title, 200) ?? project.name, idea: text(body.draft.idea, 2000), brief,
      hook: text(body.draft.hook, 1000), cta: text(body.draft.cta, 1500), sections, research, allowedSources: [...allowed].slice(0, 100),
    }, requestId)
    return NextResponse.json({ requestId, model: textModel(), proposal }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof TextProviderError ? error.status : null
    console.error('Script assist failure', { requestId, status, details: error instanceof Error ? error.message : 'unknown' })
    const message = status === 401 ? 'OpenAI rechazó la clave API.'
      : status === 403 ? 'OpenAI rechazó el acceso al modelo o al proyecto.'
      : status === 404 ? `El modelo ${textModel()} no está disponible para esta clave (OPENAI_TEXT_MODEL).`
      : status === 429 ? 'OpenAI alcanzó un límite de uso o de facturación.'
      : status && status >= 500 ? 'El servicio de texto de OpenAI no está disponible.'
      : error instanceof TextProviderError ? error.message : 'No se pudo generar la propuesta.'
    return NextResponse.json({ error: message, requestId }, { status: 502 })
  }
}
