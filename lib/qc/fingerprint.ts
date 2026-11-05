import { sha256, stableStringify } from '@/lib/queue/hash'
import type { Composition } from '@/lib/editor/composition'

/**
 * Huella de una composicion para detectar renders potencialmente duplicados.
 * Solo cuenta lo que cambia el resultado visible/audible; ignora ids de clip, titulos y marcas de tiempo.
 */
export function compositionFingerprint(c: Composition): string {
  const clips = [...c.clips].sort((a, b) => a.position - b.position).map(k => ({
    v: k.visualAssetId, a: k.voiceAssetId, d: k.durationMs, m: k.motion, t: k.trimInMs ?? 0, s: k.speed ?? 1,
    r: k.reverse === true, mu: k.muted === true, vol: k.volume ?? 1, afi: k.audioFadeInMs ?? 0, afo: k.audioFadeOutMs ?? 0, tr: k.transition ?? null, n: k.narration ?? null,
  }))
  return sha256(stableStringify({
    f: c.format, size: c.customSize ?? null, clips, music: c.musicAssetId, mv: c.musicVolume, duck: c.duckMusic,
    subs: c.subtitles, fade: c.fadeMs, audio: (c.audioClips ?? []).length, text: (c.textClips ?? []).length,
  }))
}

export type FingerprintMatch = { renderId: string; fingerprint: string }
/** Devuelve los renders previos con la misma huella (misma composicion → probable duplicado). */
export const findDuplicateRenders = (fp: string, previous: FingerprintMatch[]) => previous.filter(p => p.fingerprint === fp)
