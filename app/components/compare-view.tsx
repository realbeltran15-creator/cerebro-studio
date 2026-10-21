'use client'

import { useMemo } from 'react'
import { compareLanes, type Comparison, type Lane } from '@/lib/editor/compare'

const secs = (ms: number) => `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
const W = 720, PAD = 8, LANE_H = 34, GAP = 54

/**
 * Two lanes on the same time scale: each clip a block, each cut a tick. Cuts that both montages share are joined by a line (green: same place, within the
 * tolerance); a cut that exists in only one is marked in orange. Drawn from the measured numbers, never from the footage.
 */
export function CompareView({ a, b, beats, toleranceMs = 250 }: { a: Lane; b: Lane; beats?: readonly number[]; toleranceMs?: number }) {
  const cmp: Comparison = useMemo(() => compareLanes(a, b, { toleranceMs, beats }), [a, b, beats, toleranceMs])
  const total = Math.max(a.totalMs, b.totalMs, 1), x = (ms: number) => PAD + ms / total * (W - 2 * PAD)
  const yA = 16, yB = yA + LANE_H + GAP, H = yB + LANE_H + 22
  const lane = (l: Lane, y: number, fill: string) => <g>
    <text x={PAD} y={y - 4} fontSize="11" fill="currentColor">{l.label} · {l.clips.length} clips · {secs(l.totalMs)}</text>
    {l.clips.map((c, i) => <rect key={i} x={x(c.startMs)} y={y} width={Math.max(x(c.startMs + c.durationMs) - x(c.startMs) - 1, 1)} height={LANE_H} fill={fill} opacity={0.85} />)}
  </g>
  return <figure style={{ margin: 0 }} aria-label="Comparación visual de los dos montajes">
    <svg role="img" aria-label={`Cortes de ${a.label} y de ${b.label} sobre la misma escala de tiempo`} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 820 }}>
      {lane(a, yA, '#2f62c4')}{lane(b, yB, '#9a5b0f')}
      {cmp.matched.map((p, i) => <line key={`m${i}`} data-cut="match" x1={x(p.aMs)} y1={yA + LANE_H} x2={x(p.bMs)} y2={yB} stroke="#2fd18b" strokeWidth="1.5" />)}
      {cmp.onlyA.map((t, i) => <line key={`a${i}`} data-cut="only-a" x1={x(t)} y1={yA} x2={x(t)} y2={yA + LANE_H + 10} stroke="#ff9f43" strokeWidth="2" />)}
      {cmp.onlyB.map((t, i) => <line key={`b${i}`} data-cut="only-b" x1={x(t)} y1={yB - 10} x2={x(t)} y2={yB + LANE_H} stroke="#ff9f43" strokeWidth="2" />)}
      {(beats ?? []).filter(t => t <= total).slice(0, 1500).map((t, i) => <line key={`k${i}`} x1={x(t)} y1={yB + LANE_H + 2} x2={x(t)} y2={yB + LANE_H + 8} stroke="#8ab4ff" strokeWidth="1" />)}
    </svg>
    <figcaption className="muted small">
      <span style={{ color: '#2fd18b' }}>━</span> corte compartido (a menos de {toleranceMs} ms) · <span style={{ color: '#ff9f43' }}>┃</span> corte que solo existe en uno · {cmp.cutAgreement === null ? 'sin cortes que comparar' : `coincidencia de cortes ${Math.round(cmp.cutAgreement * 100)} %`}
      {beats?.length ? ' · marcas azules: pulsos de la música' : ''}
    </figcaption>
  </figure>
}

export function ComparisonTable({ a, b }: { a: Lane; b: Lane }) {
  const row = (name: string, x: string, y: string) => <tr key={name}><td>{name}</td><td>{x}</td><td>{y}</td></tr>
  const pct = (v: number) => `${Math.round(v * 100)} %`
  return <div className="tableScroll"><table className="dataTable" aria-label="Medidas de los dos montajes">
    <thead><tr><th>Medida</th><th>{a.label}</th><th>{b.label}</th></tr></thead>
    <tbody>
      {row('Clips', String(a.clips.length), String(b.clips.length))}
      {row('Duración total', secs(a.totalMs), secs(b.totalMs))}
      {row('Clip típico (mediana)', secs(a.medianClipMs), secs(b.medianClipMs))}
      {row('Clips cortos / largos (10 % / 90 %)', `${secs(a.p10ClipMs)} / ${secs(a.p90ClipMs)}`, `${secs(b.p10ClipMs)} / ${secs(b.p90ClipMs)}`)}
      {row('Cortes secos', pct(a.hardCutShare), pct(b.hardCutShare))}
      {row('Efectos de sonido', String(a.sfx), String(b.sfx))}
      {row('Textos en pantalla', String(a.textOverlays), String(b.textOverlays))}
      {row('Volumen de la música', pct(a.musicVolume), pct(b.musicVolume))}
    </tbody></table></div>
}
