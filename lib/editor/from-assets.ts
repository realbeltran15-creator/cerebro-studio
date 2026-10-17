import { addAudioClip, addClip } from './timeline'
import { emptyComposition, MAX_CLIP_MS, MIN_CLIP_MS, type AudioClip, type Composition, type OutputFormat } from './composition'

/**
 * Starts a manual edit from files already in the Library: videos and images go to the picture track in the order given,
 * voices, music and effects go to their own audio tracks starting at 0. Nothing is generated and nothing is copied.
 */
export type SourceAsset = { id: string; asset_type: string; durationMs: number | null }

export const IMAGE_MS = 5000
export const MAX_ASSETS = 20
const visual = new Set(['video', 'image', 'thumbnail'])
const audioKind: Record<string, AudioClip['kind']> = { voice: 'voice', audio: 'voice', music: 'music', sfx: 'sfx' }

/** Ids from "?assets=a,b,c": safe tokens only (letters, digits, - and _), no duplicates, capped. They are only ever used as query parameters. */
export function parseAssetIds(raw: string | null | undefined) {
  return [...new Set((raw ?? '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{1,64}$/.test(s)))].slice(0, MAX_ASSETS)
}

export function parseFormat(raw: string | null | undefined): OutputFormat {
  return raw === '9:16' || raw === '1:1' ? raw : '16:9'
}

export function compositionFromAssets(input: { title: string; format: OutputFormat; assets: SourceAsset[] }): Composition {
  let c: Composition = { ...emptyComposition(`manual-${globalThis.crypto.randomUUID()}`, input.title, input.format), editedManually: true }
  for (const a of input.assets) {
    if (visual.has(a.asset_type)) {
      const ms = a.asset_type === 'video' ? a.durationMs ?? IMAGE_MS : IMAGE_MS
      c = addClip(c, a.id, Math.min(Math.max(ms, MIN_CLIP_MS), MAX_CLIP_MS))
    } else if (audioKind[a.asset_type]) {
      c = addAudioClip(c, { assetId: a.id, kind: audioKind[a.asset_type], linkedClipId: null, offsetMs: 0, startMs: 0, trimInMs: 0, durationMs: Math.min(Math.max(a.durationMs ?? 10_000, 500), 20 * 60_000), volume: audioKind[a.asset_type] === 'music' ? 0.5 : 1, muted: false })
    }
  }
  return c
}

/** The link used by Studio, Library and the import screens to open files in the manual editor. */
export const manualEditorHref = (projectId: string, assetIds: string[], format?: OutputFormat) =>
  `/editor/manual?project=${encodeURIComponent(projectId)}&assets=${assetIds.map(encodeURIComponent).join(',')}${format && format !== '16:9' ? `&format=${format}` : ''}`
