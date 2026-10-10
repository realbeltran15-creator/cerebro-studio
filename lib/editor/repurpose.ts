import type { Clip } from './composition'

/**
 * Deterministic "best segment" suggestion for vertical clips (CALCULATED, not AI): scores every run of
 * consecutive scenes that fits the platform limit. Contiguity keeps the story coherent; the score rewards a
 * hook at the start, a complete sentence at the end, narration density and having a visual for every scene.
 */
export type SegmentSuggestion = {
  sceneIds: string[]
  startIndex: number
  endIndex: number
  durationMs: number
  score: number
  reasons: string[]
  method: 'heuristic'
}

const HOOK_WORDS = /\b(nadie|secreto|nunca|siempre|por qué|cómo|increíble|verdad|error|descubr|sobrevivi|ocultaba|impossible|imposible)\b/i
const wordCount = (t: string | null) => (t ? t.trim().split(/\s+/).filter(Boolean).length : 0)
const endsComplete = (t: string | null) => Boolean(t && /[.!?…»"”]\s*$/.test(t.trim()))
const hookStrength = (t: string | null) => {
  if (!t) return 0
  return (t.includes('?') ? 2 : 0) + (/\d/.test(t) ? 1 : 0) + (HOOK_WORDS.test(t) ? 1 : 0) + (wordCount(t) > 0 && wordCount(t) <= 18 ? 1 : 0)
}

export function suggestSegment(clips: Clip[], opts: { maxMs: number; minMs?: number; targetMs?: number }): SegmentSuggestion | null {
  const minMs = opts.minMs ?? 15_000
  const targetMs = Math.min(opts.targetMs ?? 45_000, opts.maxMs)
  let best: SegmentSuggestion | null = null
  for (let i = 0; i < clips.length; i++) {
    let dur = 0
    for (let j = i; j < clips.length; j++) {
      dur += clips[j].durationMs
      if (dur > opts.maxMs) break
      const run = clips.slice(i, j + 1)
      const words = run.reduce((n, c) => n + wordCount(c.narration), 0)
      const density = Math.min(words / Math.max(dur / 1000, 1) / 2.5, 1) // ~2.5 words/s is a full narration
      const visuals = run.filter(c => c.visualAssetId).length / run.length
      const hook = hookStrength(run[0].narration)
      const complete = endsComplete(run[run.length - 1].narration)
      const fit = dur >= minMs ? 1 - Math.min(Math.abs(dur - targetMs) / targetMs, 1) : dur / minMs - 1
      const score = Math.round((density * 3 + visuals * 3 + Math.min(hook, 4) * 1.5 + (complete ? 2 : 0) + fit * 3 + (i === 0 ? 0.5 : 0)) * 100) / 100
      if (!best || score > best.score) {
        const reasons: string[] = []
        if (hook >= 2) reasons.push('Empieza con un gancho (pregunta, cifra o frase corta)')
        if (complete) reasons.push('Termina en una frase completa')
        if (visuals === 1) reasons.push('Todas las escenas tienen recurso visual')
        else reasons.push(`${Math.round(visuals * 100)} % de escenas con recurso visual`)
        reasons.push(`Duración ${Math.round(dur / 1000)} s, dentro del límite de ${Math.round(opts.maxMs / 1000)} s`)
        best = { sceneIds: run.map(c => c.sceneId), startIndex: i, endIndex: j, durationMs: dur, score, reasons, method: 'heuristic' }
      }
    }
  }
  return best
}

const clean = (t: string) => t.replace(/\s+/g, ' ').trim()
const clip = (t: string, max: number) => {
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`
}

/** On-screen hook (CALCULATED): the strongest of the first sentences of the segment, trimmed to fit the 3-second overlay. */
export function suggestHook(narrations: Array<string | null>, max = 90): string | null {
  const sentences = narrations.flatMap(n => (n ? clean(n).match(/[^.!?…]+[.!?…]?/g) ?? [] : [])).map(clean).filter(s => s.length >= 8).slice(0, 6)
  if (!sentences.length) return null
  const best = sentences.reduce((a, b) => (hookStrength(b) > hookStrength(a) ? b : a))
  return clip(best.replace(/[.…]+$/, ''), max)
}

/** Title and caption drafts for the vertical post (CALCULATED from the project's own text; the owner reviews them). */
export function suggestPackaging(input: { projectName: string; hook: string | null; narrations: Array<string | null> }) {
  const title = clip(input.hook ?? input.projectName, 100)
  const body = clip(clean(input.narrations.filter(Boolean).join(' ')), 220)
  const tag = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '')
  const tags = [...new Set(input.projectName.split(/\s+/).map(tag).filter(w => w.length >= 4))].slice(0, 3).map(w => `#${w}`)
  return { title, caption: [input.hook ?? '', body && body !== input.hook ? body : '', tags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200) }
}
