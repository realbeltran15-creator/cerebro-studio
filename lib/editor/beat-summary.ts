import type { BeatResult } from './beats'
import { totalDurationMs, type Composition } from './composition'
import { beatsOnTimeline } from './sync'

export type AnalysisState = { beats?: BeatResult } | 'loading' | 'error' | undefined
export type BeatSummary = { beatsMs: number[]; bpm: number | null; confidence: number; tracks: number; analysing: number; failed: number }

/**
 * The beats of the music of a montage, on its timeline: every unmuted music clip of the audio track (placed by its start and trim) plus the global
 * background music (which plays from the start). Pulses closer than 40 ms are merged. `bpm`/`confidence` come from the most regular track.
 */
export function summarizeBeats(c: Composition | null, analyses: Record<string, AnalysisState>): BeatSummary {
  const sum: BeatSummary = { beatsMs: [], bpm: null, confidence: 0, tracks: 0, analysing: 0, failed: 0 }
  if (!c) return sum
  const out: number[] = []
  const read = (st: AnalysisState): number[] | null => {
    sum.tracks++
    if (st === undefined || st === 'loading') { sum.analysing++; return null }
    if (st === 'error') { sum.failed++; return null }
    if (st.beats && st.beats.confidence >= sum.confidence) { sum.confidence = st.beats.confidence; sum.bpm = st.beats.bpm }
    return st.beats?.beatsMs ?? null
  }
  for (const a of c.audioClips ?? []) if (a.kind === 'music' && !a.muted) { const b = read(analyses[a.assetId]); if (b) out.push(...beatsOnTimeline(c, a, b)) }
  if (c.musicAssetId && !(c.audioClips ?? []).some(a => a.kind === 'music' && a.assetId === c.musicAssetId)) { const b = read(analyses[c.musicAssetId]); const total = totalDurationMs(c); if (b) out.push(...b.filter(t => t <= total)) }
  const sorted = [...new Set(out)].sort((x, y) => x - y)
  sum.beatsMs = sorted.filter((t, i) => i === 0 || t - sorted[i - 1] >= 40)
  return sum
}
