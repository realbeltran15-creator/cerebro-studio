/** PCM 16-bit mono (lo que devuelve Gemini TTS, 24 kHz) → WAV reproducible en el navegador. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000) {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const text = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE'); text(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  text(36, 'data'); v.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length)
  out.set(new Uint8Array(header), 0)
  out.set(pcm, 44)
  return out
}

export const pcmSeconds = (pcm: Uint8Array, sampleRate = 24000) => pcm.length / 2 / sampleRate

export function sampleRateFromMime(mime: string | undefined) {
  const m = mime?.match(/rate=(\d+)/)
  return m ? Number(m[1]) : 24000
}

/** Segundos de silencio al inicio y al final (umbral de amplitud). Sirve para que el hook empiece a sonar en t≈0. */
export function trimSilence(pcm: Uint8Array, sampleRate = 24000, threshold = 400) {
  const aligned = pcm.slice() // copia con byteOffset 0: Int16Array exige alineación par
  const s = new Int16Array(aligned.buffer, 0, Math.floor(aligned.length / 2))
  let a = 0
  let b = s.length - 1
  while (a < s.length && Math.abs(s[a]) < threshold) a++
  while (b > a && Math.abs(s[b]) < threshold) b--
  const pad = Math.floor(sampleRate * 0.04)
  const from = Math.max(0, a - pad)
  const to = Math.min(s.length, b + 1 + pad)
  return aligned.slice(from * 2, to * 2)
}
