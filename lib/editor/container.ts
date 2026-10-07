/** Container of a recorded/uploaded video from its MIME type. */
export const containerOf = (mime: string | null | undefined): 'mp4' | 'webm' => (mime ?? '').startsWith('video/mp4') ? 'mp4' : 'webm'

/** Video codec named in a recorder MIME type ("video/mp4;codecs=avc1.640028,mp4a.40.2"), or null when it does not say. */
export function videoCodecOf(mime: string | null | undefined): 'h264' | 'hevc' | 'vp9' | 'vp8' | 'av1' | 'other' | null {
  const m = /codecs=([^;]+)/i.exec(mime ?? '')
  if (!m) return null
  const c = m[1].toLowerCase()
  if (/avc1|h264/.test(c)) return 'h264'
  if (/hvc1|hev1|hevc/.test(c)) return 'hevc'
  if (/vp9|vp09/.test(c)) return 'vp9'
  if (/vp8/.test(c)) return 'vp8'
  if (/av01|av1/.test(c)) return 'av1'
  return 'other'
}

/**
 * Whether Instagram Reels can take this file: MP4/MOV with H.264 or HEVC. "unknown" = an MP4 whose codec was not recorded
 * (older renders or uploads), which is allowed but cannot be guaranteed.
 */
export function instagramReadiness(mime: string | null | undefined): { ok: boolean; unknown: boolean; reason: string | null } {
  if (!/^video\/(mp4|quicktime)/i.test(mime ?? '')) return { ok: false, unknown: false, reason: 'Instagram solo acepta MP4/MOV; este vídeo es WebM. Renderízalo en Chrome, Edge o Safari.' }
  const codec = videoCodecOf(mime)
  if (codec === null) return { ok: true, unknown: true, reason: null }
  if (codec === 'h264' || codec === 'hevc') return { ok: true, unknown: false, reason: null }
  return { ok: false, unknown: false, reason: `Este MP4 usa ${codec.toUpperCase()}, que Instagram rechaza (pide H.264 o HEVC). Renderízalo en Chrome, Edge o Safari.` }
}
