/**
 * Control de calidad aislado (Fase 4B.0). Funciones puras sobre metadatos ya medidos (ffprobe/ffmpeg se
 * conectan en 4B.2): sin red, sin disco, sin efectos. Tres niveles:
 *  - fail   → bloquea el paso a «Preparado».
 *  - warn   → se muestra, no bloquea.
 *  - review → requiere decision humana (p. ej. mucho negro que puede ser intencionado).
 */
export type Severity = 'fail' | 'warn' | 'review'
export type QcFinding = { check: string; severity: Severity; code: string; message: string }
export type QcVerdict = 'pass' | 'warn' | 'review' | 'fail'

export const verdictOf = (f: QcFinding[]): QcVerdict =>
  f.some(x => x.severity === 'fail') ? 'fail' : f.some(x => x.severity === 'review') ? 'review' : f.some(x => x.severity === 'warn') ? 'warn' : 'pass'

const F = (check: string, severity: Severity, code: string, message: string): QcFinding => ({ check, severity, code, message })

// ── Duracion, resolucion y formato ──
export type VideoMeta = { durationMs: number; width: number; height: number; mimeType: string; videoCodec?: string | null; bytes?: number }
export type FormatSpec = { expectedDurationMs: number; width: number; height: number; toleranceMs?: number; mimeTypes?: string[] }

export function checkFormat(m: VideoMeta, s: FormatSpec): QcFinding[] {
  const out: QcFinding[] = []
  const tol = s.toleranceMs ?? Math.max(500, s.expectedDurationMs * 0.03)
  if (!(m.durationMs > 0)) out.push(F('format', 'fail', 'zero_duration', 'El vídeo no tiene duración.'))
  else if (Math.abs(m.durationMs - s.expectedDurationMs) > tol) {
    out.push(F('format', Math.abs(m.durationMs - s.expectedDurationMs) > tol * 4 ? 'fail' : 'warn', 'duration_mismatch',
      `Duración ${m.durationMs} ms frente a ${s.expectedDurationMs} ms esperados.`))
  }
  if (m.width !== s.width || m.height !== s.height) out.push(F('format', 'fail', 'resolution_mismatch', `Resolución ${m.width}x${m.height}; se esperaba ${s.width}x${s.height}.`))
  if (!(s.mimeTypes ?? ['video/mp4']).includes(m.mimeType)) out.push(F('format', 'fail', 'format_not_allowed', `Formato ${m.mimeType} no permitido.`))
  if (m.bytes !== undefined && m.bytes <= 0) out.push(F('format', 'fail', 'empty_file', 'El archivo está vacío.'))
  return out
}

// ── Audio ──
export type AudioMeta = { hasStream: boolean; decodable: boolean; silentRatio?: number }
export function checkAudio(a: AudioMeta, o: { narrationExpected: boolean; audioExpected: boolean }): QcFinding[] {
  const out: QcFinding[] = []
  if (!a.hasStream) {
    if (o.narrationExpected) out.push(F('audio', 'fail', 'audio_missing', 'Hay narración prevista pero el vídeo no tiene audio.'))
    else if (o.audioExpected) out.push(F('audio', 'warn', 'audio_missing', 'El vídeo no tiene pista de audio.'))
    return out
  }
  if (!a.decodable) { out.push(F('audio', 'fail', 'audio_undecodable', 'La pista de audio no se puede decodificar.')); return out }
  const silent = a.silentRatio ?? 0
  if (silent >= 0.98) out.push(F('audio', o.narrationExpected ? 'fail' : 'warn', 'audio_silent', 'El audio está prácticamente en silencio.'))
  else if (silent >= 0.6) out.push(F('audio', 'warn', 'audio_mostly_silent', `El ${Math.round(silent * 100)} % del audio es silencio.`))
  return out
}

// ── Pantallas negras ──
export type BlackSegment = { startMs: number; endMs: number }
export type SceneSpan = { sceneId: string; startMs: number; endMs: number; hasVisual: boolean; intentionalDark?: boolean }
const overlap = (a: BlackSegment, b: { startMs: number; endMs: number }) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))

/**
 * Negro por falta de material = fail. Negro sobre escena marcada como oscura a propósito = nada.
 * Negro largo sin explicación = revisión humana (puede ser artístico), nunca fail automático.
 * Fundidos de entrada/salida (≤ fadeMs en los extremos) no cuentan.
 */
export function checkBlackFrames(black: BlackSegment[], scenes: SceneSpan[], totalMs: number, o: { fadeMs?: number; reviewRatio?: number } = {}): QcFinding[] {
  const out: QcFinding[] = []
  const fade = o.fadeMs ?? 500
  let unexplained = 0
  for (const seg of black) {
    const edge = seg.endMs - seg.startMs <= fade && (seg.startMs <= 0 || seg.endMs >= totalMs)
    if (edge) continue
    let explained = 0
    for (const sc of scenes) {
      const ov = overlap(seg, sc)
      if (!ov) continue
      if (!sc.hasVisual) {
        out.push(F('black', 'fail', 'black_missing_material', `Pantalla negra en la escena ${sc.sceneId}: no tiene imagen ni vídeo.`))
        explained += ov
      } else if (sc.intentionalDark) explained += ov
    }
    unexplained += Math.max(0, seg.endMs - seg.startMs - explained)
  }
  const ratio = totalMs > 0 ? unexplained / totalMs : 0
  if (ratio >= (o.reviewRatio ?? 0.1)) out.push(F('black', 'review', 'black_unexplained', `El ${Math.round(ratio * 100)} % del vídeo está en negro sin motivo registrado; confirmar que es intencionado.`))
  else if (unexplained > 1000) out.push(F('black', 'warn', 'black_short', `${Math.round(unexplained)} ms de negro sin motivo registrado.`))
  return out
}

// ── Materiales incompletos ──
export function checkIncomplete(p: { provenance?: Record<string, unknown> | null; clips: Array<{ id: string; visualAssetId: string | null; narration?: string | null; voiceAssetId?: string | null }> }): QcFinding[] {
  const out: QcFinding[] = []
  if (p.provenance?.incomplete === true) out.push(F('incomplete', 'fail', 'render_marked_incomplete', 'El render se guardó como incompleto.'))
  const noVisual = p.clips.filter(c => !c.visualAssetId).length
  if (noVisual) out.push(F('incomplete', 'fail', 'clips_without_visual', `${noVisual} clip(s) sin imagen ni vídeo.`))
  const noVoice = p.clips.filter(c => c.narration && !c.voiceAssetId).length
  if (noVoice) out.push(F('incomplete', 'warn', 'narration_without_voice', `${noVoice} clip(s) con narración pero sin voz asignada.`))
  return out
}

// ── Licencias y atribuciones ──
export type AssetLicense = { assetId: string; license: 'own' | 'cc0' | 'cc-by' | 'cc-by-nc' | 'royalty-free' | 'unknown' | string; attribution?: string | null; source?: string | null }
export function checkLicenses(assets: AssetLicense[], o: { commercial: boolean }): QcFinding[] {
  const out: QcFinding[] = []
  for (const a of assets) {
    if (a.license === 'unknown' || !a.license) out.push(F('license', 'review', 'license_unknown', `El material ${a.assetId} no tiene licencia registrada.`))
    else if (a.license === 'cc-by' && !a.attribution?.trim()) out.push(F('license', 'fail', 'attribution_missing', `El material ${a.assetId} (CC BY) exige atribución y no la tiene.`))
    else if (a.license === 'cc-by-nc' && o.commercial) out.push(F('license', 'fail', 'noncommercial_in_commercial', `El material ${a.assetId} es no comercial.`))
  }
  return out
}

// ── Subtitulos ──
export type Cue = { startMs: number; endMs: number; text: string }
export function checkSubtitles(cues: Cue[], o: { expected: boolean; durationMs: number }): QcFinding[] {
  const out: QcFinding[] = []
  if (!o.expected) return out
  if (!cues.length) return [F('subtitles', 'fail', 'subtitles_missing', 'Se esperaban subtítulos y no hay ninguno.')]
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs)
  if (sorted.some(c => c.endMs <= c.startMs || !c.text.trim())) out.push(F('subtitles', 'fail', 'subtitle_invalid', 'Hay subtítulos vacíos o con duración no válida.'))
  if (sorted.some(c => c.endMs > o.durationMs + 250)) out.push(F('subtitles', 'warn', 'subtitle_past_end', 'Algún subtítulo termina después del vídeo.'))
  if (sorted.some((c, i) => i > 0 && c.startMs < sorted[i - 1].endMs)) out.push(F('subtitles', 'warn', 'subtitle_overlap', 'Hay subtítulos solapados.'))
  return out
}

// ── Coherencia escenas ↔ montaje ──
export type SceneRef = { id: string; position: number; durationMs: number }
export type ClipRef = { sceneId: string; position: number; durationMs: number }
export function checkSceneCoherence(scenes: SceneRef[], clips: ClipRef[], renderedMs: number): QcFinding[] {
  const out: QcFinding[] = []
  const bySc = new Set(clips.map(c => c.sceneId))
  const missing = scenes.filter(s => !bySc.has(s.id))
  if (missing.length) out.push(F('coherence', 'fail', 'scene_without_clip', `${missing.length} escena(s) del storyboard no están en el montaje.`))
  const known = new Set(scenes.map(s => s.id))
  if (clips.some(c => !known.has(c.sceneId))) out.push(F('coherence', 'warn', 'clip_without_scene', 'Hay clips que no corresponden a ninguna escena (edición manual).'))
  const order = (xs: Array<{ position: number }>) => xs.map(x => x.position)
  const sceneOrder = [...scenes].sort((a, b) => a.position - b.position).map(s => s.id).filter(id => bySc.has(id))
  const clipOrder = [...clips].sort((a, b) => a.position - b.position).map(c => c.sceneId).filter((id, i, arr) => known.has(id) && arr.indexOf(id) === i)
  if (sceneOrder.join('|') !== clipOrder.join('|')) out.push(F('coherence', 'warn', 'order_changed', 'El orden de las escenas en el montaje difiere del storyboard.'))
  void order
  const sum = clips.reduce((s, c) => s + c.durationMs, 0)
  if (renderedMs > 0 && Math.abs(sum - renderedMs) > Math.max(750, sum * 0.05)) out.push(F('coherence', 'warn', 'duration_vs_clips', `La duración renderizada (${renderedMs} ms) no coincide con la suma de clips (${sum} ms).`))
  return out
}
