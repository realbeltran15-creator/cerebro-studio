import type { Plan, PlanScene } from './types'

/** Row for `storyboards`: Shorts are always vertical. */
export const storyboardRow = (ownerId: string, projectId: string, plan: Plan) => ({ owner_id: ownerId, project_id: projectId, title: plan.title.slice(0, 160), aspect_ratio: '9:16' })

/** Characters of a scene with their locked descriptions, so every image prompt repeats the same identity. */
export function identityFor(plan: Plan, scene: PlanScene): string {
  return plan.characters.filter(c => scene.characters.some(n => n.toLowerCase() === c.name.toLowerCase()))
    .map(c => `${c.name}: ${[c.age, c.appearance, c.outfit, c.unique_traits].filter(Boolean).join(', ')}`).join('. ').slice(0, 600)
}

/** Rows for `scenes`. The animation prompt goes to video_prompt: it is what the manual (or future API) animation step uses. */
export function sceneRows(ownerId: string, storyboardId: string, plan: Plan, source: { url: string | null }) {
  return plan.scenes.map((s, i) => ({
    owner_id: ownerId, storyboard_id: storyboardId, position: i + 1, duration_ms: Math.round(s.seconds * 1000),
    narration: s.narration, visual_prompt: s.visual_prompt_en, video_prompt: s.animation_prompt_en, ambient_prompt: null,
    metadata: {
      action: s.action || null, characters: s.characters, identity: identityFor(plan, s) || null, hook: i === 0,
      recreate: { source: source.url, consistent: plan.consistent },
    },
  }))
}

/** Plain text of every animation prompt, numbered, to paste into whichever animation tool the user has the right to use. */
export const animationSheet = (plan: Plan) => plan.scenes.map((s, i) => `ESCENA ${i + 1} (${s.seconds} s)\n${s.animation_prompt_en}`).join('\n\n')
