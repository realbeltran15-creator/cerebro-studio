'use client'

import { useMemo } from 'react'
import { waveformColumns, waveformPath, type Waveform } from '@/lib/editor/waveform'

/** The real waveform of [fromMs, toMs) of an analysed audio file, drawn inside its timeline block (behind the label). */
export function WaveformSvg({ w, fromMs, toMs, width, height, color = '#fff', opacity = 0.6 }: { w: Waveform; fromMs: number; toMs: number; width: number; height: number; color?: string; opacity?: number }) {
  const d = useMemo(() => waveformPath(waveformColumns(w, fromMs, toMs, Math.min(Math.max(Math.round(width / 2), 8), 600)), Math.max(width, 1), height), [w, fromMs, toMs, width, height])
  if (!d) return null
  return <svg data-waveform="true" aria-hidden width={width} height={height} viewBox={`0 0 ${Math.max(width, 1)} ${height}`} preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}><path d={d} fill={color} opacity={opacity} /></svg>
}
