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
