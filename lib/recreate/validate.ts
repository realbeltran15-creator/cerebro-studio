import { LIMITS } from './types'
import type { AnalysisScene, Plan, PlanCharacter, PlanScene, VideoAnalysis } from './types'

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
export const VISUAL_PREFIX = 'Ultra-realistic cinematic shot, vertical 9:16,'

export function validateAnalysis(v: unknown): VideoAnalysis | null {
  if (!isObj(v)) return null
  const scenes: AnalysisScene[] = (Array.isArray(v.scenes) ? v.scenes : []).filter(isObj).slice(0, 40)
    .map(s => ({ start: num(s.start), end: num(s.end), description: str(s.description, 400), shot_type: str(s.shot_type, 80), emotion: str(s.emotion, 80) })).filter(s => s.description)
  const hook = str(v.hook, 500)
  if (!hook || scenes.length < 2) return null
  return {
    hook, hook_seconds: num(v.hook_seconds), duration_seconds: num(v.duration_seconds), scenes,
    pace: str(v.pace, 200), avg_scene_seconds: num(v.avg_scene_seconds), dominant_emotion: str(v.dominant_emotion, 120), viral_element: str(v.viral_element, 400),
    narration_style: str(v.narration_style, 300), niche: str(v.niche, 120),
    characters: (Array.isArray(v.characters) ? v.characters : []).filter(isObj).slice(0, 8).map(c => ({ name: str(c.name, 80), role: str(c.role, 120), appearance: str(c.appearance, 300), outfit: str(c.outfit, 200), expression: str(c.expression, 120) })).filter(c => c.name),
    spoken_text: str(v.spoken_text, 12000),
  }
}

/** Public view of an analysis: the reference's spoken words never leave the server. */
export const publicAnalysis = (a: VideoAnalysis) => ({ ...a, spoken_text: '' })

/**
 * Accepts a plan only when it honours the rules of the tutorial (6-10 scenes of 2-5 s, 15-40 s, narration that fits
 * its scene, characters that exist). Small slips are fixed; anything structural makes the model try again.
 */
export function validatePlan(v: unknown, consistent: boolean): Plan | null {
  if (!isObj(v)) return null
  const title = str(v.title, 160), description = str(v.description, 600)
  if (wordCount(title) < LIMITS.titleMinWords || wordCount(title) > LIMITS.titleMaxWords || !description) return null
  const characters: PlanCharacter[] = consistent
    ? (Array.isArray(v.characters) ? v.characters : []).filter(isObj).slice(0, LIMITS.maxCharacters).map(c => ({
      name: str(c.name, 60), age: str(c.age, 40), personality: str(c.personality, 200), appearance: str(c.appearance, 400), outfit: str(c.outfit, 300), expression: str(c.expression, 120), unique_traits: str(c.unique_traits, 300), prompt_en: str(c.prompt_en, 900),
    })).filter(c => c.name && c.appearance && c.prompt_en)
    : []
  if (consistent && !characters.length) return null
  const known = new Set(characters.map(c => c.name.toLowerCase()))
  const raw = (Array.isArray(v.scenes) ? v.scenes : []).filter(isObj)
  if (raw.length < LIMITS.minScenes || raw.length > LIMITS.maxScenes) return null
  const scenes: PlanScene[] = []
  for (const s of raw) {
    const seconds = Math.round((num(s.seconds) ?? 0) * 10) / 10
    if (seconds < LIMITS.minSceneSeconds || seconds > LIMITS.maxSceneSeconds) return null
    const narration = str(s.narration, 400), animation = str(s.animation_prompt_en, 600)
    let visual = str(s.visual_prompt_en, 1500)
    if (!narration || !visual || !animation) return null
    if (wordCount(narration) > Math.ceil(seconds * LIMITS.wordsPerSecond) + 2) return null
    if (!/^ultra-realistic/i.test(visual) || !/9:16/.test(visual)) visual = `${VISUAL_PREFIX} ${visual}`
    const names = (Array.isArray(s.characters) ? s.characters : []).map(n => str(n, 60)).filter(Boolean)
    if (consistent && names.some(n => !known.has(n.toLowerCase()))) return null
    scenes.push({ action: str(s.action, 300), seconds, characters: consistent ? names : [], narration, visual_prompt_en: visual, animation_prompt_en: animation })
  }
  const total = scenes.reduce((n, s) => n + s.seconds, 0)
  if (total < LIMITS.minTotalSeconds || total > LIMITS.maxTotalSeconds) return null
  return { title, description, consistent, characters, scenes }
}
