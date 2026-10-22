/**
 * Añadir materiales: what files Cerebro Studio accepts from a phone or a computer, and how to recognise a file already uploaded.
 * Pure helpers (shared by the browser panel, the iPhone shortcut API and the tests). Originals are never re-encoded here.
 */
import type { UploadKind } from '@/lib/media-upload'

/** Types iPhone apps hand over: Photos (MOV/MP4/JPEG — HEIC is converted to JPEG by Safari's picker), Files, Voice Memos (M4A). */
const BY_EXT: Record<string, { mime: string; kind: UploadKind }> = {
  mp4: { mime: 'video/mp4', kind: 'video' }, m4v: { mime: 'video/mp4', kind: 'video' }, mov: { mime: 'video/quicktime', kind: 'video' }, webm: { mime: 'video/webm', kind: 'video' },
  jpg: { mime: 'image/jpeg', kind: 'image' }, jpeg: { mime: 'image/jpeg', kind: 'image' }, png: { mime: 'image/png', kind: 'image' }, webp: { mime: 'image/webp', kind: 'image' },
  heic: { mime: 'image/heic', kind: 'image' }, heif: { mime: 'image/heif', kind: 'image' },
  m4a: { mime: 'audio/mp4', kind: 'voice' }, mp3: { mime: 'audio/mpeg', kind: 'music' }, wav: { mime: 'audio/wav', kind: 'music' }, aac: { mime: 'audio/aac', kind: 'music' },
  ogg: { mime: 'audio/ogg', kind: 'music' }, flac: { mime: 'audio/flac', kind: 'music' }, caf: { mime: 'audio/x-caf', kind: 'voice' },
}
const OK_MIME = /^(video\/(mp4|quicktime|webm)|image\/(jpeg|png|webp)|audio\/(mpeg|mp3|wav|x-wav|wave|ogg|aac|mp4|x-m4a|flac|webm))$/

export type Classified = { ok: true; kind: UploadKind; mime: string; ext: string; note?: string } | { ok: false; reason: string }

export const extOf = (name: string) => { const e = name.split('.').pop()?.toLowerCase() ?? ''; return /^[a-z0-9]{2,5}$/.test(e) && name.includes('.') ? e : '' }

/**
 * Decides how a file is stored. Voice Memos (.m4a) default to «voz», other audio to «música». HEIC photos are refused with an explanation
 * (desktop browsers cannot show them in the editor and converting would change the original); Safari's photo picker already sends JPEG.
 */
export function classify(name: string, mime: string): Classified {
  const ext = extOf(name)
  const m = (mime || '').toLowerCase().split(';')[0].trim()
  const byExt = BY_EXT[ext]
  if (m === 'image/heic' || m === 'image/heif' || ext === 'heic' || ext === 'heif') return { ok: false, reason: 'Foto HEIC: el editor del ordenador no puede mostrarla. En el iPhone elige la foto desde Fotos con el selector de Safari (la envía como JPEG) o cambia Ajustes › Cámara › Formatos › «Más compatible».' }
  if (ext === 'caf') return { ok: false, reason: 'Audio CAF: compártelo como M4A desde Notas de Voz.' }
  const finalMime = OK_MIME.test(m) ? (m === 'audio/x-m4a' ? 'audio/mp4' : m) : byExt?.mime
  if (!finalMime || !OK_MIME.test(finalMime)) return { ok: false, reason: `Formato no admitido (${m || ext || 'desconocido'}). Vídeo MP4/MOV/WebM, imagen JPEG/PNG/WebP o audio M4A/MP3/WAV/AAC/OGG/FLAC.` }
  const kind: UploadKind = finalMime.startsWith('video/') ? 'video' : finalMime.startsWith('image/') ? 'image' : (byExt?.kind === 'voice' || ext === 'm4a' ? 'voice' : 'music')
  const note = finalMime === 'video/quicktime' ? 'MOV del iPhone: si está grabado en HEVC, Chrome en Windows puede no reproducirlo; Safari, Edge con la extensión HEVC y la exportación del editor sí.' : undefined
  return { ok: true, kind, mime: finalMime, ext: ext || finalMime.split('/')[1].replace('quicktime', 'mov').replace('jpeg', 'jpg').replace('mpeg', 'mp3'), note }
}

/** Library-wide duplicate key: same name and same size (lastModified is not reliable across iPhone apps and Shortcuts). */
export const fingerprintKey = (name: string, size: number) => `${name.normalize('NFC').toLowerCase().slice(0, 200)}|${size}`

/** Content fingerprint: SHA-256 of the size plus the first and last 256 KB (cheap even for long videos, never reads the whole file). */
export async function contentFingerprint(file: Blob): Promise<string> {
  const span = 256 * 1024
  const head = await file.slice(0, Math.min(span, file.size)).arrayBuffer()
  const tail = file.size > span ? await file.slice(Math.max(span, file.size - span)).arrayBuffer() : new ArrayBuffer(0)
  const size = new TextEncoder().encode(String(file.size))
  const all = new Uint8Array(size.byteLength + head.byteLength + tail.byteLength)
  all.set(size, 0); all.set(new Uint8Array(head), size.byteLength); all.set(new Uint8Array(tail), size.byteLength + head.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', all)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
