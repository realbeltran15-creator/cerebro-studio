import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { routeStt, toSrt, toVtt, transcribe } from '@/lib/providers/transcribe'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** GET: configured transcription models. POST {assetId, language?}: transcribes a voice/audio/video asset into a subtitle asset (WebVTT + SRT). */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ models: routeStt().map(m => ({ id: m.id, label: m.label, tier: m.tier, note: m.note })) })
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { assetId?: string; language?: string } | null
  const language = body?.language && /^[a-z]{2}$/.test(body.language) ? body.language : undefined
  const { data: asset } = await supabase.from('assets').select('id,project_id,asset_type,storage_path,provenance').eq('id', body?.assetId ?? '').eq('owner_id', user.id).maybeSingle()
  const a = asset as { id: string; project_id: string | null; asset_type: string; storage_path: string | null; provenance: Record<string, unknown> | null } | null
  if (!a?.storage_path || !a.project_id || !['voice', 'video', 'music', 'sfx', 'audio'].includes(a.asset_type)) return NextResponse.json({ error: 'Elige un audio o vídeo del proyecto.' }, { status: 400 })

  // One subtitle per source asset: return the existing one instead of paying/consuming quota again.
  const { data: existing } = await supabase.from('assets').select('id,provenance').eq('owner_id', user.id).eq('asset_type', 'subtitle').eq('provenance->>sourceAssetId', a.id).maybeSingle()
  if (existing) return NextResponse.json({ asset: existing, duplicate: true })

  const { data: file, error: dlError } = await supabase.storage.from('generated-assets').download(a.storage_path)
  if (dlError || !file) return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 502 })
  let t
  try { t = await transcribe(file, a.storage_path.split('/').pop() ?? 'audio', language) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Transcripción no disponible.', attempts: (error as { attempts?: string[] }).attempts ?? [] }, { status: 502 }) }

  const vtt = toVtt(t.segments), srt = toSrt(t.segments)
  const path = `${user.id}/${a.project_id}/subtitles/${a.id}.vtt`
  const { error: upError } = await supabase.storage.from('generated-assets').upload(path, new Blob([vtt], { type: 'text/vtt' }), { contentType: 'text/vtt', upsert: false })
  if (upError) return NextResponse.json({ error: `No se pudo guardar el subtítulo: ${upError.message}` }, { status: 500 })
  const { data: saved, error } = await supabase.from('assets').insert({
    owner_id: user.id, project_id: a.project_id, asset_type: 'subtitle', storage_path: path, source_provider: t.provider, license_status: 'generated',
    provenance: {
      title: `Subtítulos · ${String(a.provenance?.title ?? a.provenance?.originalPrompt ?? a.asset_type).slice(0, 60)}`, provider: t.provider, model: t.model, costTier: t.tier,
      language: t.language, sourceAssetId: a.id, inputs: [{ id: a.id, type: a.asset_type }], segments: t.segments.slice(0, 2000), text: t.text.slice(0, 20000), srt: srt.slice(0, 60000),
      mimeType: 'text/vtt', generatedAt: new Date().toISOString(), fallbacks: t.attempts, cost: { amount: null, currency: null, reported: false },
    },
  }).select('id,provenance').single()
  if (error) { await supabase.storage.from('generated-assets').remove([path]); return NextResponse.json({ error: error.message }, { status: 500 }) }
  return NextResponse.json({ asset: saved, duplicate: false }, { status: 201 })
}
