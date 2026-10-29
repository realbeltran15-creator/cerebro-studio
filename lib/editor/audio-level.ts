/**
 * «Normalizar volumen»: calcula la ganancia que lleva el pico más alto de un tramo de audio a un nivel objetivo, a partir de la forma de onda
 * ya medida del archivo (picos por cubo, 0–255). No modifica el archivo: solo da el valor del control de volumen del clip (0–2).
 */
import type { Waveform } from './waveform'

/** Pico (0–1) del tramo [fromMs, toMs) del archivo; null si no hay datos. */
export function peakIn(w: Waveform, fromMs: number, toMs: number): number | null {
  const a = Math.max(0, Math.floor(fromMs / 1000 * w.bucketsPerSecond)), b = Math.min(w.peaks.length, Math.ceil(toMs / 1000 * w.bucketsPerSecond))
  if (b <= a) return null
  let m = 0
  for (let i = a; i < b; i++) if (w.peaks[i] > m) m = w.peaks[i]
  return m / 255
}

/** Volumen (0–2) que deja el pico del tramo en `target` (0,9 ≈ −0,9 dBFS). Tramos casi mudos no se amplifican sin límite. */
export function normalizedVolume(w: Waveform, fromMs: number, toMs: number, target = 0.9): number | null {
  const p = peakIn(w, fromMs, toMs)
  if (p === null || p < 0.01) return null
  return Math.round(Math.min(2, Math.max(0.05, target / p)) * 100) / 100
}
