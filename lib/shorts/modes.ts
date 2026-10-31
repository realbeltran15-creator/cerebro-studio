import type { Clip, Composition } from '@/lib/editor/composition'
import type { ShortScript } from './script'

/**
 * Three ways to produce the pictures of a Short, chosen by a written instruction:
 *  - free: free image models (the existing default, costs nothing);
 *  - flow: the user makes the clips in Google Flow (no public API) and imports them; costs Flow points, not money in this app;
 *  - veo: Veo through the Gemini API; paid per second, so it never runs unless the user asks for it AND confirms the cost.
 */
export type ShortMode = 'free' | 'flow' | 'veo'

export const SHORT_MODES: Array<{ id: ShortMode; label: string; cost: string }> = [
  { id: 'free', label: 'Gratis (imágenes libres)', cost: 'Sin coste' },
  { id: 'flow', label: 'Google Flow (tú creas los clips)', cost: 'Gasta puntos de tu cuenta de Flow' },
  { id: 'veo', label: 'Veo (API de Gemini)', cost: 'De pago por segundo' },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Reads "hazlo con Flow" / "usa veo" / "gratis" and returns the mode; null when the text names none (keep the current one). */
export function parseShortsInstruction(text: string): ShortMode | null {
  const t = norm(text)
  const hit = (re: RegExp) => { const m = t.search(re); return m < 0 ? Infinity : m }
  const order: Array<[ShortMode, number]> = [
    ['veo', hit(/\bveo\b/)],
    ['flow', hit(/\bflow\b/)],
    ['free', hit(/\b(gratis|gratuito|libre|sin coste|sin costo|gratuita)\b/)],
  ]
  // The mode named first wins ("con flow, no gratis" is still flow).
  const best = order.filter(([, i]) => i !== Infinity).sort((a, b) => a[1] - b[1])[0]
  return best ? best[0] : null
}

export const FLOW_CLIP_SECONDS = 8

/** One ready-to-paste Flow prompt per scene: vertical, 8 s, locked camera. */
export function flowPromptPack(script: ShortScript, extra = ''): Array<{ scene: number; prompt: string }> {
  const style = extra.trim()
  return script.scenes.map((s, i) => ({
    scene: i + 1,
    prompt: [
      `${s.visual.trim()}.`,
      `Formato vertical 9:16, ${FLOW_CLIP_SECONDS} segundos, una sola toma.`,
      'Cámara fija: sin zoom, sin paneos, sin cortes bruscos; solo movimientos leves y naturales.',
      'Sin texto, sin subtítulos ni logotipos en la imagen.',
      style,
    ].filter(Boolean).join(' '),
  }))
}

type FlowAsset = { id: string; asset_type: string; source_provider?: string | null; provenance?: unknown; created_at?: string }

/**
 * Puts imported Flow videos on the scenes. A video whose provenance names a scene goes there; the rest fill the
 * remaining scenes in import order. Never touches narration, durations or voice; scenes without a video keep their picture.
 */
export function applyFlowClips(c: Composition, assets: FlowAsset[]): { composition: Composition; applied: number } {
  const flows = assets.filter(a => a.asset_type === 'video' && a.source_provider === 'google-flow-import')
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  const sceneOf = (a: FlowAsset) => { const p = a.provenance as { sceneId?: unknown } | null; return typeof p?.sceneId === 'string' ? p.sceneId : null }
  const byScene = new Map<string, string>()
  for (const a of flows) { const s = sceneOf(a); if (s && c.clips.some(k => k.sceneId === s)) byScene.set(s, a.id) }
  const loose = flows.filter(a => !sceneOf(a) || !c.clips.some(k => k.sceneId === sceneOf(a)))
  let applied = 0
  const clips: Clip[] = c.clips.map(k => {
    let id = byScene.get(k.sceneId)
    if (!id && loose.length) id = loose.shift()!.id
    if (!id) return k
    applied++
    return { ...k, visualAssetId: id, motion: 'none' }
  })
  return { composition: { ...c, clips }, applied }
}

/** Cost of Veo for a script, so the user sees the number before confirming. Rates in USD per second at 720p. */
export const VEO_RATES = { lite: 0.05, fast: 0.10, standard: 0.40 } as const
export function veoEstimate(scenes: number, tier: keyof typeof VEO_RATES, seconds = FLOW_CLIP_SECONDS) {
  return Math.round(scenes * seconds * VEO_RATES[tier] * 100) / 100
}
