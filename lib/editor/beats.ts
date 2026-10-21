/**
 * Beat / onset detection measured locally from the audio itself (no AI, no upload).
 *  1. OnsetBuilder reads decoded chunks and keeps one «onset strength» value per 10 ms hop: how much the (high-passed) energy rose.
 *  2. detectBeats picks the strong peaks of that curve with an adaptive threshold and estimates the tempo by autocorrelation.
 * It finds hits that are really in the signal; it does not invent a grid. `confidence` says how regular the pulse is (0 = not at all).
 */
export const HOP_MS = 10

export type Onsets = { hopMs: number; strength: Float32Array }
export type BeatResult = { beatsMs: number[]; bpm: number | null; /** 0..1 regularity of the pulse. */ confidence: number }

export class OnsetBuilder {
  private readonly hop: number
  private readonly out: number[] = []
  private acc = 0
  private n = 0
  private prevSample = 0
  private prevLog = 0
  constructor(sampleRate: number) { this.hop = Math.max(1, Math.round(sampleRate * HOP_MS / 1000)) }
  push(channels: Float32Array[]) {
    const len = channels[0]?.length ?? 0
    for (let i = 0; i < len; i++) {
      let x = 0
      for (const ch of channels) x += ch[i]
      x /= channels.length
      // First difference = a cheap high-pass: it keeps the transients (drum hits, plucks) and drops the sustained bass and hum.
      const d = x - this.prevSample
      this.prevSample = x
      this.acc += d * d
      if (++this.n === this.hop) {
        const l = Math.log1p(1000 * this.acc / this.n)
        this.out.push(Math.max(0, l - this.prevLog))
        this.prevLog = l
        this.acc = 0; this.n = 0
      }
    }
  }
  finish(): Onsets { return { hopMs: HOP_MS, strength: Float32Array.from(this.out) } }
}

const percentile = (xs: ArrayLike<number>, q: number) => { const s = Array.from(xs).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0 }

export function detectBeats(o: Onsets, opts: { minGapMs?: number; sensitivity?: number } = {}): BeatResult {
  const s = o.strength, n = s.length, hop = o.hopMs
  if (n < 50) return { beatsMs: [], bpm: null, confidence: 0 }
  const minGap = Math.max(1, Math.round((opts.minGapMs ?? 180) / hop)), k = opts.sensitivity ?? 1.2
  // Adaptive threshold: local mean + k·std over ±0.5 s, with prefix sums so a long file stays O(n).
  const half = Math.round(500 / hop)
  const sum = new Float64Array(n + 1), sq = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) { sum[i + 1] = sum[i] + s[i]; sq[i + 1] = sq[i] + s[i] * s[i] }
  const floor = 0.25 * percentile(s, 0.95)
  const cand: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (s[i] < floor || s[i] < s[i - 1] || s[i] <= s[i + 1]) continue
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1), m = (sum[b] - sum[a]) / (b - a)
    const sd = Math.sqrt(Math.max(0, (sq[b] - sq[a]) / (b - a) - m * m))
    if (s[i] > m + k * sd) cand.push(i)
  }
  // Keep the strongest hit inside every min-gap neighbourhood.
  const picked: number[] = []
  for (const i of cand) {
    const last = picked[picked.length - 1]
    if (last === undefined || i - last >= minGap) picked.push(i)
    else if (s[i] > s[last]) picked[picked.length - 1] = i
  }
  const beatsMs = picked.map(i => Math.round(i * hop))

  // Tempo by autocorrelation of the onset curve between 60 and 200 BPM.
  const lo = Math.round(60000 / 200 / hop), hi = Math.min(n - 1, Math.round(60000 / 60 / hop))
  const mean = sum[n] / n
  let ac0 = 0
  for (let i = 0; i < n; i++) ac0 += (s[i] - mean) ** 2
  let best = 0, bestLag = 0
  if (ac0 > 0 && hi > lo) for (let lag = lo; lag <= hi; lag++) {
    let v = 0
    for (let i = 0; i + lag < n; i++) v += (s[i] - mean) * (s[i + lag] - mean)
    v /= ac0
    if (v > best) { best = v; bestLag = lag }
  }
  if (!bestLag) return { beatsMs, bpm: null, confidence: 0 }
  let bpm = 60000 / (bestLag * hop)
  while (bpm < 70) bpm *= 2
  while (bpm > 180) bpm /= 2
  return { beatsMs, bpm: Math.round(bpm * 10) / 10, confidence: Math.round(Math.min(1, Math.max(0, best)) * 100) / 100 }
}
