/**
 * Music gain automation for the renderer, as a pure list of Web Audio events.
 * The music fades in over 1 s; a voice that is already playing when the fade-in ends must be
 * ducked by the fade-in itself, because a later ramp event would override an earlier duck.
 */

export type GainEvent =
  | { type: 'set'; value: number; time: number }
  | { type: 'ramp'; value: number; time: number }
  | { type: 'target'; value: number; time: number; timeConstant: number }

export const DUCK_RATIO = 0.35
const FADE_IN_S = 1
const DUCK_LEAD_S = 0.15

export function musicGainPlan(input: { base: number; t0: number; end: number; duck: boolean; voices: Array<{ start: number; end: number }> }): GainEvent[] {
  const { base, t0, end } = input
  const ducked = base * DUCK_RATIO
  const fadeEnd = t0 + FADE_IN_S
  const windows = input.duck ? [...input.voices].sort((a, b) => a.start - b.start) : []
  const voiceAt = (t: number) => windows.some(w => t >= w.start - DUCK_LEAD_S && t < w.end)
  const events: GainEvent[] = [
    { type: 'set', value: 0, time: t0 },
    { type: 'ramp', value: voiceAt(fadeEnd) ? ducked : base, time: fadeEnd },
  ]
  for (const w of windows) {
    const start = Math.max(w.start - DUCK_LEAD_S, t0)
    if (start >= fadeEnd) events.push({ type: 'target', value: ducked, time: start, timeConstant: 0.08 })
    if (w.end >= fadeEnd) events.push({ type: 'target', value: base, time: w.end, timeConstant: 0.25 })
  }
  events.push({ type: 'target', value: 0, time: Math.max(end - 1.2, fadeEnd), timeConstant: 0.3 })
  return events.sort((a, b) => a.time - b.time)
}

export function applyGainPlan(param: AudioParam, events: GainEvent[]) {
  for (const e of events) {
    if (e.type === 'set') param.setValueAtTime(e.value, e.time)
    else if (e.type === 'ramp') param.linearRampToValueAtTime(e.value, e.time)
    else param.setTargetAtTime(e.value, e.time, e.timeConstant)
  }
}
