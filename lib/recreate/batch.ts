import { identityFor } from './build'
import type { Plan, PlanCharacter, PlanScene } from './types'

/**
 * The batch only ever uses these two models, both with a free allowance. It never falls back to another model:
 * if one refuses (allowance used, rate limit) the batch stops and says so. Paid models need the Studio's own confirmation.
 */
export const FREE_IMAGE_MODEL = 'cloudflare:@cf/black-forest-labs/flux-2-klein-4b'
export const FREE_VOICE_MODEL = 'gemini:gemini-3.8-flash-tts'
/** FLUX.2 klein takes at most 4 reference images. */
export const MAX_REFS_PER_SCENE = 4

export type GenerateBody = Record<string, unknown>

export const characterRequest = (projectId: string, c: PlanCharacter): GenerateBody => ({
  projectId, modelId: FREE_IMAGE_MODEL, prompt: c.prompt_en, preset: 'photorealistic', options: { format: '9:16' }, selection: 'recreate:free',
  identity: `${c.name}: ${[c.age, c.appearance, c.outfit, c.unique_traits].filter(Boolean).join(', ')}`.slice(0, 600),
})

export const sceneImageRequest = (projectId: string, plan: Plan, scene: PlanScene, sceneId: string, refsByName: Record<string, string>): GenerateBody => {
  const refs = scene.characters.map(n => refsByName[n.toLowerCase()]).filter((x): x is string => Boolean(x)).slice(0, MAX_REFS_PER_SCENE)
  return {
    projectId, sceneId, modelId: FREE_IMAGE_MODEL, prompt: scene.visual_prompt_en, preset: 'photorealistic', options: { format: '9:16' }, selection: 'recreate:free',
    referenceAssetIds: refs.length ? refs : undefined, identity: identityFor(plan, scene) || undefined,
  }
}

export const voiceRequest = (projectId: string, scene: PlanScene, sceneId: string, voice = 'Charon'): GenerateBody => ({
  projectId, sceneId, modelId: FREE_VOICE_MODEL, prompt: scene.narration, voice, language: 'es', selection: 'recreate:free',
})

/** Which scene a clip belongs to: the first number in its file name (escena-3.mp4 → 3), else its position in the selection. */
export function matchClipsToScenes(fileNames: string[], sceneCount: number): Array<number | null> {
  const used = new Set<number>()
  const byNumber = fileNames.map(n => { const m = n.replace(/\.[^.]+$/, '').match(/(\d{1,2})/); const k = m ? Number(m[1]) : NaN; return k >= 1 && k <= sceneCount ? k : null })
  const allNumbered = byNumber.every(k => k !== null) && new Set(byNumber).size === byNumber.length
  if (allNumbered) return byNumber
  return fileNames.map((_, i) => (i < sceneCount && !used.has(i + 1) ? (used.add(i + 1), i + 1) : null))
}
