/** Comprueba la cabecera real del archivo contra el tipo declarado (el MIME y la extensión los pone quien sube y no son de fiar). */
export type SniffKind = 'video' | 'image' | 'audio'

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.slice(from, from + len))

/** Qué es realmente según sus primeros bytes, o null si no se reconoce. */
export function sniffMedia(head: Uint8Array): SniffKind | null {
  if (head.length < 4) return null
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image'                 // JPEG
  if (head[0] === 0x89 && ascii(head, 1, 3) === 'PNG') return 'image'                          // PNG
  if (ascii(head, 0, 4) === 'RIFF' && head.length >= 12) {
    const t = ascii(head, 8, 4)
    return t === 'WEBP' ? 'image' : t === 'WAVE' ? 'audio' : null
  }
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {                                      // MP4 / MOV / M4A
    const brand = ascii(head, 8, 4)
    return /^(M4A |M4B |M4P )/.test(brand) ? 'audio' : 'video'
  }
  if (head.length >= 8 && /^(moov|mdat|wide|free|skip)$/.test(ascii(head, 4, 4))) return 'video'    // MOV antiguo de QuickTime sin ftyp
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video' // EBML: WebM (también puede ser audio WebM)
  if (ascii(head, 0, 3) === 'ID3') return 'audio'                                               // MP3 con etiqueta
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'audio'                             // MP3/AAC (ADTS) sin etiqueta
  if (ascii(head, 0, 4) === 'OggS' || ascii(head, 0, 4) === 'fLaC') return 'audio'
  return null
}

/** true si la cabecera es coherente con lo declarado. WebM acepta audio o vídeo. */
export function headerMatches(head: Uint8Array, declared: SniffKind): boolean {
  const real = sniffMedia(head)
  if (!real) return false
  if (real === declared) return true
  return real === 'video' && declared === 'audio' && head[0] === 0x1a // audio/webm
}
