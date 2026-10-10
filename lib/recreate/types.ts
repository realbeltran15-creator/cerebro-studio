/** "Short desde referencia": analysis of a reference video and the original story recreated from its structure. */

export type AnalysisScene = { start: number | null; end: number | null; description: string; shot_type: string; emotion: string }
export type AnalysisCharacter = { name: string; role: string; appearance: string; outfit: string; expression: string }

export type VideoAnalysis = {
  hook: string
  hook_seconds: number | null
  duration_seconds: number | null
  scenes: AnalysisScene[]
  pace: string
  avg_scene_seconds: number | null
  dominant_emotion: string
  viral_element: string
  narration_style: string
  niche: string
  characters: AnalysisCharacter[]
  /**
   * Spoken words of the reference, used ONLY to measure how much of it a recreation repeats.
   * It is never stored or shown, and is stripped before the analysis is sent to the browser.
   */
  spoken_text: string
}

export type PlanCharacter = {
  name: string; age: string; personality: string; appearance: string; outfit: string; expression: string; unique_traits: string
  /** English prompt of the character (identity reference). */
  prompt_en: string
}

export type PlanScene = {
  action: string
  seconds: number
  /** Names of the characters that appear (must exist in `characters`). */
  characters: string[]
  narration: string
  visual_prompt_en: string
  animation_prompt_en: string
}

export type Plan = { title: string; description: string; consistent: boolean; characters: PlanCharacter[]; scenes: PlanScene[] }

export const LIMITS = {
  minScenes: 6, maxScenes: 10, minSceneSeconds: 2, maxSceneSeconds: 5, minTotalSeconds: 15, maxTotalSeconds: 40,
  /** Spoken Spanish ≈ 2.6 words/s; a scene of 5 s fits ~13 words. */
  wordsPerSecond: 2.6, titleMinWords: 6, titleMaxWords: 14, maxCharacters: 5,
} as const

export const ORIGINALITY = {
  /** Share of the recreated narration's 4-word sequences found in the reference's spoken text. */
  maxNarrationOverlap: 0.2,
  /** Word overlap (Jaccard) between the new title and the reference title. */
  maxTitleSimilarity: 0.6,
} as const
