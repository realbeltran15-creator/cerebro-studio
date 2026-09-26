import type { SupabaseClient } from '@supabase/supabase-js'
import type { Composition } from './composition'
import type { MediaSource } from './renderer'

export type EditorAsset = {
  id: string
  asset_type: string
  storage_path: string | null
  license_status: string
  source_provider: string | null
  provenance: Record<string, unknown> | null
  created_at: string
}

export const visualTypes = ['image', 'thumbnail', 'video']
export const voiceTypes = ['voice', 'audio']
export const musicTypes = ['music', 'sfx', 'audio']

export function assetLabel(a: EditorAsset) {
  const p = a.provenance ?? {}
  const text = p.title ?? p.concept ?? p.originalPrompt ?? p.text ?? a.asset_type
  return `${String(text).slice(0, 60)} · ${new Date(a.created_at).toLocaleDateString()}`
}

export async function signedUrl(assetId: string) {
  const r = await fetch(`/api/assets/${assetId}/signed-url`, { cache: 'no-store' })
  const json = await r.json().catch(() => ({})) as { url?: string; error?: string }
  if (!r.ok || !json.url) throw new Error(json.error ?? 'No se pudo acceder a un recurso.')
  return json.url
}

const kindOf = (type: string): MediaSource['kind'] => (type === 'video' ? 'video' : visualTypes.includes(type) ? 'image' : 'audio')

/** Downloads every asset the composition uses. Private files are fetched through short-lived signed URLs. */
export async function downloadCompositionMedia(c: Composition, assets: EditorAsset[], onStep?: (done: number, total: number) => void) {
  const byId = new Map(assets.map(a => [a.id, a]))
  const ids = [...new Set([...c.clips.flatMap(k => [k.visualAssetId, k.voiceAssetId]), c.musicAssetId].filter((x): x is string => Boolean(x)))]
  const media = new Map<string, MediaSource>()
  let done = 0
  for (const id of ids) {
    const asset = byId.get(id)
    if (!asset) throw new Error('El montaje usa un recurso que ya no existe. Revísalo antes de renderizar.')
    const response = await fetch(await signedUrl(id))
    if (!response.ok) throw new Error(`No se pudo descargar «${assetLabel(asset)}».`)
    media.set(id, { kind: kindOf(asset.asset_type), blob: await response.blob() })
    onStep?.(++done, ids.length)
  }
  return media
}

/** Inputs with unverified or restricted licenses make the output unverified too. */
function outputLicense(inputs: EditorAsset[]) {
  return inputs.some(a => a.license_status === 'unknown' || a.license_status === 'restricted') ? 'unknown' : 'owned'
}

export async function saveRender(supabase: SupabaseClient, input: {
  projectId: string
  jobId: string
  composition: Composition
  blob: Blob
  mimeType: string
  durationMs: number
  assets: EditorAsset[]
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('La sesión ha caducado.')
  const used = new Set([...input.composition.clips.flatMap(k => [k.visualAssetId, k.voiceAssetId]), input.composition.musicAssetId].filter(Boolean))
  const inputs = input.assets.filter(a => used.has(a.id))
  const storagePath = `${user.id}/${input.projectId}/renders/${input.jobId}.webm`
  const { error: uploadError } = await supabase.storage.from('generated-assets').upload(storagePath, input.blob, { contentType: 'video/webm', upsert: false })
  if (uploadError) throw new Error(`No se pudo subir el vídeo (${Math.round(input.blob.size / 1048576)} MB): ${uploadError.message}. Puedes descargarlo desde esta página.`)
  const { data: asset, error } = await supabase.from('assets').insert({
    owner_id: user.id,
    project_id: input.projectId,
    asset_type: 'video',
    storage_path: storagePath,
    source_provider: 'browser-render',
    license_status: outputLicense(inputs),
    provenance: {
      title: `${input.composition.title || 'Montaje'} · ${input.composition.format}`,
      purpose: input.composition.origin?.kind === 'repurpose' ? 'short' : 'render',
      renderJobId: input.jobId,
      storyboardId: input.composition.storyboardId,
      format: input.composition.format,
      durationMs: input.durationMs,
      mimeType: input.mimeType,
      bytes: input.blob.size,
      renderer: 'browser-mediarecorder',
      inputs: inputs.map(a => ({ id: a.id, type: a.asset_type, license: a.license_status, provider: a.source_provider })),
    },
  }).select('id').single()
  if (error) {
    await supabase.storage.from('generated-assets').remove([storagePath])
    throw new Error(`No se pudo registrar el vídeo: ${error.message}`)
  }
  const { error: jobError } = await supabase.from('render_jobs').update({ status: 'completed', output_asset_id: asset.id, error: null, updated_at: new Date().toISOString() }).eq('id', input.jobId)
  if (jobError) throw new Error(`El vídeo se guardó, pero no se pudo cerrar el trabajo de render: ${jobError.message}`)
  return asset as { id: string }
}

/** Measures an audio asset's real duration by decoding it. */
export async function audioDurationMs(assetId: string) {
  const response = await fetch(await signedUrl(assetId))
  const ctx = new AudioContext()
  try {
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer())
    return Math.round(buffer.duration * 1000)
  } finally { await ctx.close() }
}
