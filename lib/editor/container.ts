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

export type Mp4Codecs = { video: 'h264' | 'hevc' | 'vp9' | 'av1' | 'other' | null; audio: 'aac' | 'opus' | 'other' | null }

/**
 * Reads the real codecs from an MP4's sample descriptions ('stsd' boxes), not from its name or MIME type.
 * Looks at the start and the end of the file, where `moov` lives (faststart or not).
 */
export function mp4Codecs(bytes: Uint8Array): Mp4Codecs {
  const out: Mp4Codecs = { video: null, audio: null }
  const windowSize = 2 * 1024 * 1024
  const regions = bytes.length <= windowSize * 2 ? [bytes] : [bytes.subarray(0, windowSize), bytes.subarray(bytes.length - windowSize)]
  const str = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
  for (const b of regions) {
    for (let i = 4; i + 20 < b.length; i++) {
      if (b[i] !== 0x73 || str(b, i) !== 'stsd') continue
      const fourcc = str(b, i + 16)
      if (fourcc === 'avc1' || fourcc === 'avc3') out.video = 'h264'
      else if (fourcc === 'hvc1' || fourcc === 'hev1') out.video = 'hevc'
      else if (fourcc === 'vp09') out.video = 'vp9'
      else if (fourcc === 'av01') out.video = 'av1'
      else if (fourcc === 'mp4a') out.audio = 'aac'
      else if (fourcc === 'Opus') out.audio = 'opus'
      else if (/^[\x20-\x7e]{4}$/.test(fourcc) && !['mett', 'tx3g', 'text', 'c608', 'c708', 'rtp ', 'tmcd'].includes(fourcc)) {
        // An unrecognised media sample entry: video entries are far larger than audio ones, so only record what we can tell apart.
        if (!out.video && /^(vp08|mp4v|jpeg|apch|apcn|ap4h)$/.test(fourcc)) out.video = 'other'
        else if (!out.audio && /^(ac-3|ec-3|alac|fLaC|sowt|twos)$/.test(fourcc)) out.audio = 'other'
      }
    }
  }
  return out
}

/** True when the file is an MP4 that Instagram Reels takes: H.264 or HEVC video and, if it has audio, AAC. */
export function isInstagramReadyMp4(bytes: Uint8Array) {
  const c = mp4Codecs(bytes)
  return (c.video === 'h264' || c.video === 'hevc') && (c.audio === null || c.audio === 'aac')
}
