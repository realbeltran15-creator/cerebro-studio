import type { ImageSize } from './types'

/**
 * Prompt pipeline for documentary / YouTube imagery. The goal is photographs that do not read as
 * "AI art": concrete camera and light language, real-world imperfection, and an explicit list of the
 * usual tells to avoid. gpt-image-1 has no negative prompt, so avoidances are written as instructions.
 */

export type ImagePreset = 'photorealistic' | 'cinematic' | 'documentary' | 'archival' | 'illustration'
export type ImageQuality = 'medium' | 'high'

export const imagePresets: Record<ImagePreset, { label: string; direction: string; realism: boolean }> = {
  photorealistic: {
    label: 'Fotorealista',
    realism: true,
    direction: 'A real photograph taken on a full-frame digital camera with a 35mm lens at eye level, natural available light only, accurate exposure with soft shadows, true-to-life colour with neutral white balance, shallow but realistic depth of field.',
  },
  cinematic: {
    label: 'Cinematográfico',
    realism: true,
    direction: 'A still frame from a live-action film shot on a cinema camera with anamorphic lenses, motivated practical lighting from real sources in the scene, restrained filmic colour grade, natural contrast, subtle halation and fine grain, composed with the subject off-centre.',
  },
  documentary: {
    label: 'Documental',
    realism: true,
    direction: 'An unposed documentary photograph by a photojournalist, handheld 28mm lens, available light, candid moment in progress, subjects unaware of the camera, ordinary lived-in environment with incidental clutter and wear, slightly imperfect framing.',
  },
  archival: {
    label: 'Archivo / histórico',
    realism: true,
    direction: 'An authentic period photograph from the era of the story, taken with a camera and film stock of that time, period-accurate clothing, objects and architecture, natural film grain, mild fading and softness typical of the original print, no modern elements.',
  },
  illustration: {
    label: 'Ilustración',
    realism: false,
    direction: 'A hand-drawn editorial illustration with visible pencil and ink linework and a restrained watercolour palette, clear storytelling, flat light, no photographic rendering.',
  },
}

const realismRules = 'Show real human features: visible skin pores and texture, natural asymmetry, real hair strands, hands with five correctly shaped fingers, clothing with creases and wear, weathered surfaces. People look like ordinary people, not models.'
const avoidRules = 'Avoid: glossy or plastic-looking skin, airbrushed faces, over-saturated HDR colour, glowing rim light and god rays, fantasy haze, lens-flare effects, symmetrical centred poses, stock-photo smiles, dramatic studio lighting, surreal or impossible elements, text, captions, logos, watermarks and signatures.'

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

/** Builds the exact prompt sent to the provider. It is stored in the asset provenance. */
export function buildImagePrompt(input: { subject: string; preset: ImagePreset; format?: string | null; context?: string | null }) {
  const p = imagePresets[input.preset]
  const orientation = input.format === '9:16' ? 'Vertical 9:16 frame' : input.format === '1:1' ? 'Square frame' : 'Horizontal 16:9 frame'
  return [
    `Scene: ${input.subject.trim()}`,
    input.context?.trim() ? `Story context (for accuracy, do not illustrate literally): ${input.context.trim().slice(0, 600)}` : null,
    `${orientation}. ${p.direction}`,
    p.realism ? realismRules : null,
    avoidRules,
  ].filter(Boolean).join('\n\n')
}
