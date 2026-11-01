import { sniffMedia } from '@/lib/ingest/sniff'

export type GeneratedKind = 'image' | 'thumbnail' | 'video' | 'voice' | 'render' | 'sfx' | 'music'
export type Verdict = { ok: true } | { ok: false; reason: string }

/** True when the start of the buffer is mostly printable text (an error page or JSON body returned with HTTP 200). */
export function looksLikeText(head: Uint8Array) {
  if (!head.length) return false
  const n = Math.min(head.length, 256)
  let printable = 0
  for (let i = 0; i < n; i++) { const b = head[i]; if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++ }
  return printable / n > 0.95
}

/**
 * A job may only be marked «completed» when its output exists and is what it claims to be. Images and videos need a real media header;
 * audio is more lenient (some providers return headerless audio) but never empty or text.
 */
export function verifyGeneratedBytes(kind: GeneratedKind, bytes: Uint8Array): Verdict {
  if (!bytes.length) return { ok: false, reason: 'El proveedor devolvió un archivo vacío.' }
  const head = bytes.subarray(0, 32)
  const real = sniffMedia(head)
  const wants = kind === 'image' || kind === 'thumbnail' ? 'image' : kind === 'video' || kind === 'render' ? 'video' : 'audio'
  if (wants === 'audio') {
    if (real === 'audio' || (real === 'video' && head[0] === 0x1a)) return { ok: true }
    if (real) return { ok: false, reason: `El proveedor devolvió ${real === 'image' ? 'una imagen' : 'un vídeo'} en lugar de audio.` }
    if (looksLikeText(bytes.subarray(0, 256))) return { ok: false, reason: 'El proveedor devolvió texto en lugar de audio (posible mensaje de error).' }
    return { ok: true }
  }
  if (real !== wants) return { ok: false, reason: real ? `El proveedor devolvió ${real === 'audio' ? 'audio' : real === 'image' ? 'una imagen' : 'un vídeo'} en lugar de ${wants === 'image' ? 'una imagen' : 'un vídeo'}.` : `El archivo recibido no es ${wants === 'image' ? 'una imagen' : 'un vídeo'} válido.` }
  return { ok: true }
}
