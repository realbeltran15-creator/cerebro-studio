import type { ImageSize } from './types'

/**
 * Prompt pipeline for documentary / YouTube imagery. The goal is photographs that do not read as
 * "AI art": concrete camera and light language, real-world imperfection, and an explicit list of the
 * usual tells to avoid. Models without a negative-prompt field get the avoidances as written
 * instructions; models with one (Ideogram, Kling, Veo…) get them separately.
 *
 * Three families of look: photographic, cinematic and artistic. The first five keys are the
 * original documentary presets and keep their ids so saved projects still resolve.
 */

export type ImagePreset =
  | 'photorealistic' | 'cinematic' | 'documentary' | 'archival' | 'illustration'
  | 'portrait' | 'product' | 'macro' | 'street' | 'landscape' | 'film35'
  | 'noir' | 'oil_painting' | 'watercolor' | 'concept_art'
export type ImageQuality = 'medium' | 'high'
export type PresetGroup = 'photo' | 'cinema' | 'art'

type Preset = {
  label: string
  group: PresetGroup
  direction: string
  /** Photographic looks get the human-realism rules (skin, hands, wear). Painted looks do not. */
  realism: boolean
  /** Extra avoidances specific to this look. */
  avoid?: string
}

export const imagePresets: Record<ImagePreset, Preset> = {
  photorealistic: {
    label: 'Fotorealista', group: 'photo', realism: true,
    direction: 'A real photograph taken on a full-frame digital camera with a 35mm lens at eye level, natural available light only, accurate exposure with soft shadows, true-to-life colour with neutral white balance, shallow but realistic depth of field.',
  },
  cinematic: {
    label: 'Cinematográfico', group: 'cinema', realism: true,
    direction: 'A still frame from a live-action film shot on a cinema camera with anamorphic lenses, motivated practical lighting from real sources in the scene, restrained filmic colour grade, natural contrast, subtle halation and fine grain, composed with the subject off-centre.',
  },
  documentary: {
    label: 'Documental', group: 'photo', realism: true,
    direction: 'An unposed documentary photograph by a photojournalist, handheld 28mm lens, available light, candid moment in progress, subjects unaware of the camera, ordinary lived-in environment with incidental clutter and wear, slightly imperfect framing.',
  },
  archival: {
    label: 'Archivo / histórico', group: 'photo', realism: true,
    direction: 'An authentic period photograph from the era of the story, taken with a camera and film stock of that time, period-accurate clothing, objects and architecture, natural film grain, mild fading and softness typical of the original print, no modern elements.',
  },
  illustration: {
    label: 'Ilustración', group: 'art', realism: false,
    direction: 'A hand-drawn editorial illustration with visible pencil and ink linework and a restrained watercolour palette, clear storytelling, flat light, no photographic rendering.',
  },
  portrait: {
    label: 'Retrato', group: 'photo', realism: true,
    direction: 'A natural portrait photograph on a full-frame camera with an 85mm lens at f/2, soft window light from one side with gentle fall-off, sharp focus on the nearest eye with natural catchlights, a relaxed unposed expression, an ordinary background softly out of focus.',
    avoid: 'beauty-filter smoothing, enlarged eyes, perfectly symmetrical faces, whitened teeth, heavy makeup unless the scene requires it, mannequin-like stillness',
  },
  product: {
    label: 'Producto', group: 'photo', realism: true,
    direction: 'A commercial product photograph on a seamless backdrop, large softbox key light with a fill card, accurate materials and true colour, crisp focus across the object, clean realistic reflections and contact shadows, no retouching artefacts.',
    avoid: 'melted or warped edges, impossible reflections, floating objects without shadow, garbled labels',
  },
  macro: {
    label: 'Macro', group: 'photo', realism: true,
    direction: 'A macro photograph with a 100mm macro lens at 1:1, extreme close detail with a razor-thin plane of focus, natural diffused daylight, tiny real-world imperfections such as dust, droplets and fibres visible.',
  },
  street: {
    label: 'Calle / candid', group: 'photo', realism: true,
    direction: 'A candid street photograph with a 35mm lens, available city light, people mid-motion going about their day, a layered foreground and background, honest framing with an element cut by the edge, subtle motion blur where movement occurs.',
  },
  landscape: {
    label: 'Paisaje', group: 'photo', realism: true,
    direction: 'A landscape photograph taken from a tripod with a 24mm lens at f/8, golden hour light raking across the terrain, deep depth of field with a clear foreground, midground and horizon, natural colour with realistic atmospheric haze.',
    avoid: 'oversaturated skies, impossible floating mountains, duplicated trees or clouds',
  },
  film35: {
    label: 'Película 35 mm', group: 'cinema', realism: true,
    direction: 'A 35mm colour film photograph on Kodak Portra 400 stock, visible organic grain, soft halation around highlights, slightly lifted blacks and gentle colour shifts, a scanned-negative look with minor dust and vignetting.',
  },
  noir: {
    label: 'Cine negro', group: 'cinema', realism: true,
    direction: 'A black-and-white film noir still, one hard motivated light source with deep shadows and strong contrast, venetian-blind or window shadows, fine silver grain, low camera angle, smoke or steam in the air, composed with strong diagonals.',
  },
  oil_painting: {
    label: 'Óleo', group: 'art', realism: false,
    direction: 'A traditional oil painting on canvas with visible brushwork and impasto, a limited earthy palette, soft directional light in the manner of classical realist painters, subtle craquelure.',
    avoid: 'digital airbrush gradients, photographic sharpness, plastic sheen',
  },
  watercolor: {
    label: 'Acuarela', group: 'art', realism: false,
    direction: 'A watercolour painting on textured cold-press paper with wet-on-wet washes, visible pigment blooms and paper grain, loose ink outlines, white paper left untouched for highlights.',
    avoid: 'digital gradients, hard vector edges, photographic detail',
  },
  concept_art: {
    label: 'Concept art', group: 'art', realism: false,
    direction: 'Professional concept art with painterly digital brushwork, a strong silhouette and clear focal point, atmospheric perspective and a readable value structure, designed for a film pre-production deck.',
    avoid: 'cluttered noise, muddy values, generic fantasy poses',
  },
}

export const presetGroupLabels: Record<PresetGroup, string> = { photo: 'Fotográficos', cinema: 'Cinematográficos', art: 'Artísticos' }

const realismRules = 'Show real human features: visible skin pores and texture, natural asymmetry, real hair strands, hands with five correctly shaped fingers, clothing with creases and wear, weathered surfaces. People look like ordinary people, not models.'
const avoidRules = 'Avoid: glossy or plastic-looking skin, airbrushed faces, over-saturated HDR colour, glowing rim light and god rays, fantasy haze, lens-flare effects, symmetrical centred poses, stock-photo smiles, dramatic studio lighting, surreal or impossible elements, text, captions, logos, watermarks and signatures.'
/** The same avoidances as a comma list, for models that take a separate negative prompt. */
const avoidList = 'glossy or plastic-looking skin, airbrushed faces, over-saturated HDR colour, glowing rim light, god rays, fantasy haze, lens flare, symmetrical centred poses, stock-photo smile, extra or fused fingers, deformed hands, warped anatomy, distorted eyes, text, captions, logos, watermark, signature'

export function sizeForFormat(format: string | null | undefined): ImageSize {
  if (format === '9:16') return '1024x1536'
  if (format === '1:1') return '1024x1024'
  return '1536x1024'
}

export function isPreset(v: unknown): v is ImagePreset {
  return typeof v === 'string' && v in imagePresets
}

/** Older requests used other style ids; map them to the closest preset. */
export function presetFrom(style: unknown): ImagePreset {
  if (isPreset(style)) return style
  if (style === 'vintage') return 'archival'
  if (style === 'anime' || style === '3d' || style === 'fantasy' || style === 'surreal' || style === 'minimal') return 'illustration'
  return 'documentary'
}

export type ImagePromptInput = {
  subject: string
  preset: ImagePreset
  format?: string | null
  context?: string | null
  /** Reference images attached to the request (identity or style). */
  references?: { count: number; role?: 'identity' | 'style' }
  /** Locked description of a recurring character, repeated verbatim in every scene. */
  identity?: string | null
  /** The target model has its own negative-prompt field: the avoid list is returned apart instead of inside the prompt. */
  nativeNegative?: boolean
  /** User negatives to merge (only used when the model has a native negative field). */
  extraNegative?: string | null
}

const orientationOf = (format?: string | null) => (format === '9:16' ? 'Vertical 9:16 frame' : format === '1:1' ? 'Square frame' : 'Horizontal 16:9 frame')

function referenceRule(r: NonNullable<ImagePromptInput['references']>) {
  if (r.role === 'style') {
    return `Use the ${r.count > 1 ? `${r.count} attached images` : 'attached image'} only as a style reference for colour, light and texture; do not copy its subject or composition.`
  }
  return `Use the ${r.count > 1 ? `${r.count} attached reference images` : 'attached reference image'} as the identity reference: keep exactly the same face, age, skin tone, hair, build and distinguishing features, and the same clothing details unless the scene says otherwise. Change only the pose, expression, setting, framing and lighting.`
}

/** Builds the prompt and, for models with a negative field, the negative prompt. Both are stored in the asset provenance. */
export function buildImageRequest(input: ImagePromptInput): { prompt: string; negative: string | null } {
  const p = imagePresets[input.preset]
  const identity = input.identity?.trim()
  const parts = [
    `Scene: ${input.subject.trim()}`,
    identity ? `Character (identical in every scene, do not change): ${identity.slice(0, 600)}` : null,
    input.references && input.references.count > 0 ? referenceRule(input.references) : null,
    input.context?.trim() ? `Story context (for accuracy, do not illustrate literally): ${input.context.trim().slice(0, 600)}` : null,
    `${orientationOf(input.format)}. ${p.direction}`,
    p.realism ? realismRules : null,
    p.avoid ? `Also avoid: ${p.avoid}.` : null,
  ]
  if (!input.nativeNegative) return { prompt: [...parts, avoidRules].filter(Boolean).join('\n\n'), negative: null }
  const negative = [avoidList, p.avoid, input.extraNegative?.trim()].filter(Boolean).join(', ').slice(0, 1000)
  return { prompt: parts.filter(Boolean).join('\n\n'), negative }
}

/** Builds the exact prompt sent to a provider without a negative field (kept for existing callers). */
export function buildImagePrompt(input: Omit<ImagePromptInput, 'nativeNegative' | 'extraNegative'>) {
  return buildImageRequest({ ...input, nativeNegative: false }).prompt
}

/**
 * The two ways of working requested for images. Free never spends money; max picks the best quality
 * available but the page still asks for the cost confirmation before anything paid is sent.
 */
export const imageModes = {
  free: { label: 'Modo gratis', strategy: 'free_only', minQuality: 3, hint: 'Solo capas gratuitas (Cloudflare FLUX.2 klein). Si el cupo diario se agota, se recomienda otra opción gratuita; nunca se pasa a una de pago.' },
  max: { label: 'Máxima calidad', strategy: 'best_quality', minQuality: 5, hint: 'El mejor modelo configurado (OpenAI GPT Image, Nano Banana Pro, FLUX.2 Pro…). Es de pago: se muestra el coste estimado y hay que confirmarlo.' },
} as const
export type ImageMode = keyof typeof imageModes
