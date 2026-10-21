/**
 * Edición por instrucciones: short Spanish sentences → real timeline operations.
 * A fixed, documented grammar (no AI, no network): every recognised instruction becomes the same pure operations the buttons use,
 * the editor applies the result as ONE undo step and shows what changed. Anything not understood is reported, never guessed.
 *
 * Scope of an instruction: the marked fragment if there is one, else the selected clip, else the clip under the playhead;
 * «todo», «todas las imágenes», «todos los vídeos» widen it.
 */
import { clipStarts, MAX_CLIP_MS, MIN_CLIP_MS, totalDurationMs, type AudioClip, type CameraKind, type Clip, type Composition, type OutputFormat, type Transition } from './composition'
import { addAudioClip, addTextClip, deleteClip, duplicateClip, setSpeed, splitClip, updateClip } from './timeline'
import { clipIdsInRange, deleteRange, isolateRange, type Range } from './range'

export type CommandAsset = { id: string; label: string; type: string; durationMs?: number | null }
export type CommandContext = {
  playheadMs: number
  range: Range | null
  selectedClipId: string | null
  /** Material selected in the materials panel («esta música»). */
  selectedAssetId: string | null
  assets: CommandAsset[]
  beatsMs: readonly number[]
  isVideo: (clip: Clip) => boolean
}
export type CommandResult = { ok: true; composition: Composition; done: string[] } | { ok: false; message: string }

export const COMMAND_EXAMPLES = [
  'corta aquí', 'corta en 1:20', 'borra este fragmento', 'duplica el clip',
  'pon esta música desde el minuto 2', 'pon la música «lluvia» desde 0:30 hasta 2:00 al 40 %', 'baja la música al 20 %', 'sube la voz', 'silencia el vídeo',
  'haz un zoom lento', 'zoom rápido en todas las imágenes', 'panorámica a la derecha', 'sin movimiento',
  'cambia de imagen siguiendo el ritmo', 'cambia de imagen cada 4 pulsos', 'transición de disolvencia en todo', 'corte seco',
  'cámara lenta', 'velocidad 2x', 'pon el título «Capítulo 1» en el segundo 5 durante 3 segundos', 'formato vertical', 'quita los subtítulos',
]

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim()
const fmt = (ms: number) => { const t = Math.round(ms / 100) / 10; const m = Math.floor(t / 60); const s = t - m * 60; return m ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)} s` }

/** «1:23», «minuto 2», «minuto 2 y 30», «2 minutos 30 segundos», «segundo 12», «12 s», «0,5 segundos». */
export function parseTime(raw: string): number | null {
  const s = fold(raw)
  let m = /(\d{1,3}):(\d{1,2})(?:[.,](\d))?/.exec(s)
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(m[3] ?? 0) * 100
  m = /minuto\s+(\d+(?:[.,]\d+)?)(?:\s*(?:y|con)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:segundos?|s))?)?/.exec(s)
  if (m) return Math.round((Number(m[1].replace(',', '.')) * 60 + Number((m[2] ?? '0').replace(',', '.'))) * 1000)
  m = /(\d+(?:[.,]\d+)?)\s*(?:minutos?|min)\b(?:\s*(?:y\s*)?(\d+(?:[.,]\d+)?)\s*(?:segundos?|seg|s)\b)?/.exec(s)
  if (m) return Math.round((Number(m[1].replace(',', '.')) * 60 + Number((m[2] ?? '0').replace(',', '.'))) * 1000)
  m = /segundo\s+(\d+(?:[.,]\d+)?)/.exec(s) ?? /(\d+(?:[.,]\d+)?)\s*(?:segundos?|seg|s)\b/.exec(s)
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 1000)
  return null
}
const after = (s: string, words: RegExp) => { const m = words.exec(s); return m ? s.slice(m.index + m[0].length) : null }
const timeAfter = (s: string, words: RegExp) => { const rest = after(s, words); return rest === null ? null : parseTime(rest.split(/\b(?:hasta|durante|al|a la|con)\b/)[0]) }
const percent = (s: string) => { const m = /(\d+(?:[.,]\d+)?)\s*(?:%|por ?ciento)/.exec(s); return m ? Number(m[1].replace(',', '.')) / 100 : null }

/** Clips an instruction applies to (see module comment). */
function scope(c: Composition, s: string, ctx: CommandContext): { ids: string[]; label: string } {
  const isImg = (k: Clip) => !ctx.isVideo(k)
  if (/\b(todas las imagenes|todas las fotos)\b/.test(s)) return { ids: c.clips.filter(isImg).map(k => k.id), label: 'todas las imágenes' }
  if (/\b(todos los videos|todos los clips de video)\b/.test(s)) return { ids: c.clips.filter(k => ctx.isVideo(k)).map(k => k.id), label: 'todos los vídeos' }
  if (/\b(todo|todos|todas|todo el video|todo el montaje|en todo)\b/.test(s)) return { ids: c.clips.map(k => k.id), label: 'todo el montaje' }
  if (ctx.range) { const ids = clipIdsInRange(c, ctx.range); return { ids, label: `el fragmento ${fmt(ctx.range.startMs)}–${fmt(ctx.range.endMs)}` } }
  if (ctx.selectedClipId && c.clips.some(k => k.id === ctx.selectedClipId)) return { ids: [ctx.selectedClipId], label: `el clip ${c.clips.findIndex(k => k.id === ctx.selectedClipId) + 1}` }
  const st = clipStarts(c)
  const i = c.clips.findIndex((k, n) => ctx.playheadMs >= st[n] && ctx.playheadMs < st[n] + k.durationMs)
  return i >= 0 ? { ids: [c.clips[i].id], label: `el clip ${i + 1} (bajo el cabezal)` } : { ids: [], label: '' }
}

/** Finds the material an instruction names: a quoted name, words of its label, «esta» (selected in the panel), or the most recent of that kind. */
function findAsset(text: string, s: string, ctx: CommandContext, kinds: string[]): CommandAsset | null {
  const pool = ctx.assets.filter(a => kinds.includes(a.type))
  const quoted = /[«"“']([^»"”']+)[»"”']/.exec(text)?.[1]
  if (quoted) { const q = fold(quoted); return pool.find(a => fold(a.label).includes(q)) ?? null }
  if (/\b(esta|este|la seleccionada|el seleccionado)\b/.test(s) && ctx.selectedAssetId) return pool.find(a => a.id === ctx.selectedAssetId) ?? null
  const named = pool.find(a => fold(a.label).split(/[^a-z0-9]+/).filter(w => w.length >= 4).some(w => s.includes(w)))
  return named ?? pool[0] ?? null
}

/** Clip lengths so each clip in `ids` lasts `perCut` beats (cuts land on beats); images take any length, videos keep their source start. */
export function retimeToBeats(input: Composition, ids: string[], beats: readonly number[], perCut: number): { composition: Composition; changed: number } {
  let c = input
  let changed = 0
  const want = new Set(ids)
  for (const k of input.clips) {
    if (!want.has(k.id)) continue
    const st = clipStarts(c)[c.clips.findIndex(x => x.id === k.id)]
    const gap = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 500
    // The clip ends on the first beat at least `perCut` beat intervals (and the minimum clip length) after its start.
    const end = beats.find(b => b >= st + Math.max(MIN_CLIP_MS, perCut * gap * 0.9)) ?? null
    if (end === null) continue
    const d = Math.min(Math.max(end - st, MIN_CLIP_MS), MAX_CLIP_MS)
    if (Math.abs(d - k.durationMs) > 20) { c = updateClip(c, k.id, { durationMs: d }); changed++ }
  }
  return { composition: c, changed }
}

const TRANS: Array<[RegExp, Transition]> = [[/disolvencia|fundido encadenado|crossfade/, 'dissolve'], [/fundido( a negro)?/, 'fade'], [/deslizar|deslizamiento|slide/, 'slide'], [/cortinilla|barrido|wipe/, 'wipe'], [/transicion de zoom|zoom de transicion/, 'zoom'], [/corte seco|corte directo|sin transicion/, 'cut']]

/** Runs one instruction. Several can be chained with «y luego», «después» or «;». */
export function runInstruction(c0: Composition, text: string, ctx: CommandContext): CommandResult {
  const parts = text.split(/\s*(?:;|\by luego\b|\by despues\b|\bdespues\b|\.\s+)\s*/i).map(t => t.trim()).filter(Boolean)
  if (!parts.length) return { ok: false, message: 'Escribe una instrucción.' }
  let c = c0
  const done: string[] = []
  for (const part of parts) {
    const r = runOne(c, part, ctx)
    if (!r.ok) return { ok: false, message: parts.length > 1 ? `«${part}»: ${r.message}` : r.message }
    c = r.composition; done.push(...r.done)
  }
  return { ok: true, composition: c, done }
}

function runOne(c: Composition, text: string, ctx: CommandContext): CommandResult {
  const s = fold(text)
  const total = totalDurationMs(c)
  const ok = (composition: Composition, ...d: string[]): CommandResult => ({ ok: true, composition, done: d })
  const fail = (message: string): CommandResult => ({ ok: false, message })

  // ---- Texts and titles: «pon el título "X" en el segundo 5 durante 3 segundos (arriba)»
  if (/\b(texto|titulo|rotulo)\b/.test(s) && /\b(pon|anade|escribe|mete|agrega|crea)\b/.test(s)) {
    const content = /[«"“']([^»"”']+)[»"”']/.exec(text)?.[1]?.trim()
    if (!content) return fail('Pon el texto entre comillas, por ejemplo: pon el título «Capítulo 1».')
    const at = timeAfter(s, /\b(?:en|desde|a partir de)\b(?: el)?/) ?? ctx.range?.startMs ?? ctx.playheadMs
    const dur = timeAfter(s, /\bdurante\b/) ?? (ctx.range ? ctx.range.endMs - ctx.range.startMs : 3000)
    const position = /\barriba\b/.test(s) ? 'top' : /\babajo\b/.test(s) ? 'bottom' : 'center'
    const isTitle = /\btitulo\b/.test(s)
    return ok(addTextClip(c, { content, startMs: Math.min(at, Math.max(0, total - 300)), durationMs: dur, position, sizePct: isTitle ? 10 : 6, animation: 'fade', font: 'sans', color: '#ffffff' }),
      `${isTitle ? 'Título' : 'Texto'} «${content}» en ${fmt(at)} durante ${fmt(dur)}.`)
  }

  // ---- Music / voice / effect on the audio track: «pon esta música desde el minuto 2 (hasta el minuto 4) (al 30 %)»
  const placeVerb = /\b(pon|ponle|anade|mete|usa|agrega|coloca|inserta)\b/.test(s)
  const audioWord = /\b(musica|cancion|voz|narracion|efecto|sonido)\b/.test(s)
  const placementHint = /\b(desde|hasta|a partir|esta|este|minuto|segundo)\b/.test(s) || /\d+:\d+/.test(s) || /[«"“']/.test(text)
  if (placeVerb && audioWord && (placementHint || percent(s) === null)) {
    const kind: AudioClip['kind'] = /\b(voz|narracion)\b/.test(s) ? 'voice' : /\b(efecto|sonido)\b/.test(s) ? 'sfx' : 'music'
    const types = kind === 'music' ? ['music', 'audio'] : kind === 'voice' ? ['voice', 'audio'] : ['sfx', 'audio']
    const a = findAsset(text, s, ctx, types)
    if (!a) return fail(kind === 'music' ? 'No encuentro esa música en los materiales del proyecto. Selecciónala en el panel o escribe su nombre entre comillas.' : 'No encuentro ese audio en los materiales del proyecto.')
    const start = timeAfter(s, /\b(?:desde|a partir de|en)\b(?: el)?/) ?? ctx.range?.startMs ?? 0
    if (start >= total) return fail(`El montaje dura ${fmt(total)}: no se puede empezar en ${fmt(start)}.`)
    const end = /\bhasta el final\b/.test(s) ? total : timeAfter(s, /\bhasta\b(?: el)?/) ?? (ctx.range && !/\bdesde\b/.test(s) ? ctx.range.endMs : null)
    const own = a.durationMs ?? null
    const durationMs = Math.max(500, Math.min(end !== null ? end - start : own ?? total - start, total - start, own ?? Infinity))
    const vol = percent(s) ?? (kind === 'music' ? 0.3 : 1)
    return ok(addAudioClip(c, { assetId: a.id, kind, linkedClipId: null, offsetMs: 0, startMs: start, trimInMs: 0, durationMs, volume: vol, muted: false }),
      `${kind === 'music' ? 'Música' : kind === 'voice' ? 'Voz' : 'Efecto'} «${a.label}» de ${fmt(start)} a ${fmt(start + durationMs)} al ${Math.round(vol * 100)} %.`)
  }

  // ---- Volumes: «baja la música al 20 %», «sube la voz», «silencia el vídeo»
  const trackOf = (): 'music' | 'voice' | 'sfx' | 'video' | null => /\bmusica\b/.test(s) ? 'music' : /\b(voz|voces|narracion)\b/.test(s) ? 'voice' : /\befectos?\b/.test(s) ? 'sfx' : /\b(video|videos|audio original|sonido original)\b/.test(s) ? 'video' : null
  if (/\b(sube|baja|bajale|subele|volumen|silencia|quita el sonido|mutea|activa el sonido|pon el sonido)\b/.test(s) || (/\bal\s+\d/.test(s) && trackOf())) {
    const track = trackOf()
    if (!track) return fail('Dime qué pista: música, voz, efectos o vídeo.')
    const mute = /\b(silencia|quita el sonido|mutea)\b/.test(s) ? true : /\b(activa el sonido|pon el sonido)\b/.test(s) ? false : null
    const pct = percent(s)
    const rel = pct === null && mute === null ? (/\bsube|subele\b/.test(s) ? 1.3 : /\bbaja|bajale\b/.test(s) ? 0.6 : null) : null
    if (pct === null && rel === null && mute === null) return fail('Indica el volumen, por ejemplo: baja la música al 20 %.')
    const setVol = (v: number) => Math.min(2, Math.max(0, pct ?? v * (rel ?? 1)))
    if (track === 'video') {
      const ids = new Set(ctx.range || ctx.selectedClipId ? scope(c, s, ctx).ids : c.clips.map(k => k.id))
      let n = 0
      const next = { ...c, clips: c.clips.map(k => (ids.has(k.id) && ctx.isVideo(k) ? (n++, { ...k, ...(mute !== null ? { muted: mute } : { volume: setVol(k.volume ?? 1), muted: false }) }) : k)) }
      return n ? ok(next, `Audio original de ${n} vídeo${n === 1 ? '' : 's'} ${mute ? 'silenciado' : mute === false ? 'activado' : `al ${Math.round(setVol(1) * 100)} %`}.`) : fail('No hay clips de vídeo en esa parte.')
    }
    let n = 0
    const audioClips = (c.audioClips ?? []).map(a => (a.kind === track ? (n++, { ...a, ...(mute !== null ? { muted: mute } : { volume: setVol(a.volume), muted: false }) }) : a))
    let next: Composition = { ...c, audioClips }
    if (track === 'music' && c.musicAssetId) { next = { ...next, musicVolume: Math.min(1, mute ? 0 : setVol(c.musicVolume)) }; n++ }
    const name = track === 'music' ? 'Música' : track === 'voice' ? 'Voz' : 'Efectos'
    return n ? ok(next, `${name}: ${mute ? 'silenciada' : mute === false ? 'activada' : pct !== null ? `al ${Math.round(pct * 100)} %` : rel! > 1 ? 'un 30 % más alta' : 'un 40 % más baja'} (${n} pista${n === 1 ? '' : 's'}).`) : fail(`No hay ${name.toLowerCase()} en el montaje.`)
  }

  // ---- Delete: «borra este fragmento», «elimina el clip»
  if (/^(borra|elimina|quita|suprime)\b/.test(s) && !/\b(zoom|movimiento|subtitulos|musica|voz|efectos?|transicion)\b/.test(s)) {
    if (ctx.range && !/\bclip\b/.test(s)) { const r = deleteRange(c, ctx.range); return r.removedMs ? ok(r.composition, `Fragmento eliminado (${fmt(r.removedMs)}); lo que venía después se adelanta.`) : fail('El fragmento no contiene clips completos.') }
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('No hay ningún clip seleccionado ni bajo el cabezal.')
    return ok(sc.ids.reduce((x, id) => deleteClip(x, id), c), `Eliminado ${sc.label}.`)
  }

  // ---- Cut: «corta aquí», «corta en 1:20», «divide en el segundo 12»
  if (/^(corta|divide|parte|separa|corte en|haz un corte)\b/.test(s) && !/\bseco\b/.test(s)) {
    if (ctx.range && /\b(aqui|fragmento|seleccion)\b/.test(s)) { const r = isolateRange(c, ctx.range); return ok(r.composition, `Cortado en ${fmt(r.range.startMs)} y ${fmt(r.range.endMs)}: el fragmento queda en ${r.ids.length} clip${r.ids.length === 1 ? '' : 's'} propios.`) }
    const at = parseTime(s) ?? ctx.playheadMs
    const st = clipStarts(c)
    const i = c.clips.findIndex((k, n) => at > st[n] && at < st[n] + k.durationMs)
    if (i < 0) return fail(`En ${fmt(at)} no hay ningún clip que cortar.`)
    const local = at - st[i]
    if (local < MIN_CLIP_MS || c.clips[i].durationMs - local < MIN_CLIP_MS) return fail(`Cortar en ${fmt(at)} dejaría un trozo de menos de 1 s.`)
    return ok(splitClip(c, c.clips[i].id, local), `Corte en ${fmt(at)} (clip ${i + 1}).`)
  }

  // ---- Duplicate
  if (/^(duplica|repite|copia)\b/.test(s)) {
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('No hay ningún clip seleccionado ni bajo el cabezal.')
    return ok(sc.ids.reduce((x, id) => duplicateClip(x, id), c), `Duplicado ${sc.label}.`)
  }

  // ---- Rhythm: «cambia de imagen siguiendo el ritmo», «cada 4 pulsos»
  if (/\b(ritmo|pulso|pulsos|compas|beat|beats)\b/.test(s)) {
    if (!ctx.beatsMs.length) return fail('Todavía no hay pulso: añade música a la pista de música y espera a que se mida.')
    const per = Number(/cada\s+(\d+)\s*(?:pulsos?|beats?|tiempos?)/.exec(s)?.[1] ?? 0)
    const gap = ctx.beatsMs.length > 1 ? (ctx.beatsMs[ctx.beatsMs.length - 1] - ctx.beatsMs[0]) / (ctx.beatsMs.length - 1) : 500
    const perCut = per > 0 ? per : Math.max(1, Math.ceil(MIN_CLIP_MS / gap), gap < 700 ? 2 : 1)
    const sc = /\b(imagen|imagenes|foto|fotos)\b/.test(s) && !ctx.range && !ctx.selectedClipId ? { ids: c.clips.filter(k => !ctx.isVideo(k)).map(k => k.id), label: 'las imágenes' } : (ctx.range || /\btodo\b/.test(s) ? scope(c, s, ctx) : { ids: c.clips.map(k => k.id), label: 'todo el montaje' })
    const r = retimeToBeats(c, sc.ids, ctx.beatsMs, perCut)
    return r.changed ? ok(r.composition, `${r.changed} clip${r.changed === 1 ? '' : 's'} de ${sc.label} cambian cada ${perCut} pulso${perCut === 1 ? '' : 's'} (~${Math.round(gap * perCut / 100) / 10} s).`) : fail('Los clips ya caen en los pulsos.')
  }

  // ---- Camera: «haz un zoom lento», «panorámica a la derecha», «sin movimiento»
  const cam: CameraKind | null = /\b(sin movimiento|quita el (zoom|movimiento)|fijo|fija|camara fija)\b/.test(s) ? 'none'
    : /\b(aleja|alejar|alejamiento|zoom out|abre el plano)\b/.test(s) ? 'zoom_out'
    : /\bpanoramica\b.*\bizquierda\b|\bpaneo\b.*\bizquierda\b/.test(s) ? 'pan_left'
    : /\bpanoramica\b|\bpaneo\b/.test(s) ? 'pan_right'
    : /\b(sube la camara|camara hacia arriba)\b/.test(s) ? 'pan_up'
    : /\b(baja la camara|camara hacia abajo)\b/.test(s) ? 'pan_down'
    : /\b(zoom|acerca|acercar|acercamiento|zoom in|cierra el plano)\b/.test(s) ? 'zoom_in' : null
  if (cam) {
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('Selecciona un clip, marca un fragmento o pon el cabezal sobre un clip.')
    const amount = /\b(muy lento|muy suave)\b/.test(s) ? 0.05 : /\b(lento|suave|ligero|poco)\b/.test(s) ? 0.08 : /\b(rapido|fuerte|intenso|mucho|dramatico)\b/.test(s) ? 0.25 : 0.12
    const ids = new Set(sc.ids)
    return ok({ ...c, clips: c.clips.map(k => (ids.has(k.id) ? { ...k, camera: { kind: cam, amount } } : k)) },
      cam === 'none' ? `Sin movimiento de cámara en ${sc.label}.` : `${({ zoom_in: 'Zoom', zoom_out: 'Alejamiento', pan_left: 'Panorámica a la izquierda', pan_right: 'Panorámica a la derecha', pan_up: 'Subida de cámara', pan_down: 'Bajada de cámara' } as Record<string, string>)[cam]} ${amount <= 0.08 ? 'lento' : amount >= 0.25 ? 'rápido' : ''} en ${sc.label}.`.replace(/\s+en/, ' en'))
  }

  // ---- Transitions
  const tr = TRANS.find(([re]) => re.test(s))?.[1]
  if (tr && /\b(transicion|transiciones|fundido|corte seco|corte directo|disolvencia|cortinilla|deslizar|sin transicion)\b/.test(s)) {
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('Selecciona un clip o marca un fragmento.')
    const ids = new Set(sc.ids)
    return ok({ ...c, clips: c.clips.map(k => (ids.has(k.id) ? { ...k, transition: tr } : k)) }, `Transición «${({ fade: 'fundido a negro', dissolve: 'disolvencia', slide: 'deslizar', wipe: 'cortinilla', zoom: 'zoom', cut: 'corte seco' } as Record<Transition, string>)[tr]}» en ${sc.label}.`)
  }

  // ---- Speed: «cámara lenta», «velocidad 2x», «al doble», «a la mitad»
  if (/\b(camara lenta|velocidad|acelera|ralentiza|al doble|a la mitad|mas rapido|mas lento|\d+(?:[.,]\d+)?\s*x)\b/.test(s)) {
    const m = /(\d+(?:[.,]\d+)?)\s*x\b/.exec(s) ?? /velocidad\s+(?:de\s+|al?\s+)?(\d+(?:[.,]\d+)?)/.exec(s)
    const speed = m ? Number(m[1].replace(',', '.')) : /\b(camara lenta|a la mitad|ralentiza|mas lento)\b/.test(s) ? 0.5 : /\bal doble\b/.test(s) ? 2 : /\b(acelera|mas rapido)\b/.test(s) ? 1.5 : null
    if (speed === null || speed < 0.25 || speed > 4) return fail('La velocidad va de 0,25x a 4x.')
    const sc = scope(c, s, ctx)
    const vids = c.clips.filter(k => sc.ids.includes(k.id) && ctx.isVideo(k))
    if (!vids.length) return fail('La velocidad solo cambia en clips de vídeo.')
    return ok(vids.reduce((x, k) => setSpeed(x, k.id, speed), c), `Velocidad ${speed}× en ${vids.length} clip${vids.length === 1 ? '' : 's'} de vídeo de ${sc.label}.`)
  }

  // ---- Format and subtitles
  const format: OutputFormat | null = /\b(vertical|9:16|short|reel|tiktok)\b/.test(s) ? '9:16' : /\b(horizontal|16:9|youtube)\b/.test(s) ? '16:9' : /\b(cuadrado|1:1)\b/.test(s) ? '1:1' : null
  if (format && /\b(formato|pasalo|ponlo|hazlo|convierte)\b/.test(s)) return ok({ ...c, format }, `Formato ${format}.`)
  if (/\bsubtitulos?\b/.test(s)) {
    const on = !/\b(quita|desactiva|sin|oculta|elimina)\b/.test(s)
    return ok({ ...c, subtitles: on }, `Subtítulos ${on ? 'activados' : 'desactivados'}.`)
  }

  return fail('No he entendido la instrucción.')
}
