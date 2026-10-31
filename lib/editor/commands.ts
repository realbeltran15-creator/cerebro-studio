/**
 * Edición por instrucciones: short Spanish sentences → real timeline operations.
 * A fixed, documented grammar (no AI, no network): every recognised instruction becomes the same pure operations the buttons use,
 * the editor applies the result as ONE undo step and shows what changed. Anything not understood is reported, never guessed.
 *
 * Scope of an instruction: the marked fragment if there is one, else the selected clip, else the clip under the playhead;
 * «todo», «todas las imágenes», «todos los vídeos» widen it.
 */
import { audioStartMs, clipStarts, compositionCues, envelopeAt, MAX_CLIP_MS, MIN_CLIP_MS, totalDurationMs, type AudioClip, type CameraKind, type Clip, type Composition, type OutputFormat, type Transition } from './composition'
import { addAudioClip, addTextClip, deleteClip, duplicateClip, moveClip, setLevelBetween, setSpeed, splitClip, updateClip } from './timeline'
import { cutSfxClips, defaultCutSfx, removeCutSfx, setCutSfx } from './cut-sfx'
import { clipIdsInRange, deleteRange, isolateRange, type Range } from './range'
import { DEFAULT_PREFS, type EditPreferences, type Watch } from './preferences'
import { addOverlay, addMarker, deleteItems, duplicateItems, setKeyframe, updateOverlay, type ItemRef } from './tracks'
import { FILTER_PRESETS, NO_FILTERS, type Filters, type Transform } from './composition'
import { transformAt } from './motion'

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
  /** The owner's confirmed preferences (defaults when absent). */
  prefs?: EditPreferences
  /** Everything selected on the timeline (overlays, texts, audio…), for instructions about «esta capa». */
  selectedItems?: ItemRef[]
}
export type CommandResult = { ok: true; composition: Composition; done: string[]; /** Values set by default, watched to propose a preference if the owner corrects them. */ watch?: Watch[]; /** Navigation asked for («ve al minuto 2», «selecciona del 1:00 al 1:30»). */ playheadMs?: number; range?: Range | null; /** «deshaz» / «rehaz»: handled by the editor's history. */ history?: 'undo' | 'redo'; /** «guarda este estilo»: the editor measures the montage and stores it as a style with this name. */ saveStyle?: string } | { ok: false; message: string }

export const COMMAND_EXAMPLES = [
  'corta del minuto 1 al 1:30', 'que la música entre poco a poco', 'fundido de salida de 3 segundos en la música', 'quita la voz del minuto 2 al 3', 'que dure 4 segundos', 'mueve este clip al principio',
  've al minuto 2', 'selecciona del 0:10 al 0:20', 'pon el efecto «whoosh» en los cortes', 'baja la música cuando hable', 'subtítulos palabra a palabra', 'deshaz',
  'corta aquí', 'corta en 1:20', 'borra este fragmento', 'duplica el clip',
  'pon esta música desde el minuto 2', 'pon la música «lluvia» desde 0:30 hasta 2:00 al 40 %', 'baja la música al 20 %', 'sube la voz', 'silencia el vídeo',
  'haz un zoom lento', 'zoom rápido en todas las imágenes', 'panorámica a la derecha', 'sin movimiento',
  'cambia de imagen siguiendo el ritmo', 'cambia de imagen cada 4 pulsos', 'transición de disolvencia en todo', 'corte seco',
  'cámara lenta', 'velocidad 2x', 'pon el título «Capítulo 1» en el segundo 5 durante 3 segundos', 'formato vertical', 'quita los subtítulos',
  'pon esta imagen encima del vídeo durante 8 segundos', 'pon esta imagen en la esquina superior derecha', 'haz la capa más grande', 'que la capa vaya de izquierda a derecha',
  'blanco y negro', 'más brillo', 'filtro cálido', 'desenfoca el fondo', 'añade una transición suave', 'transición de desenfoque', 'pon un marcador', 'baja la música mientras habla la persona',
]

const NUM_WORDS: Record<string, string> = { un: '1', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12', trece: '13', catorce: '14', quince: '15', dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40', cincuenta: '50', sesenta: '60', medio: '0.5' }
/** «dos segundos» → «2 segundos», «medio segundo» → «0.5 segundo» (only before a time unit, so names are left alone). */
const numWords = (s: string) => s.replace(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|medio)\s+(segundos?|minutos?|milisegundos?)\b/g, (_m, w: string, u: string) => `${NUM_WORDS[w]} ${u}`)
const fold = (s: string) => numWords(s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim())
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
const TIME_TOKEN = /(\d{1,3}:\d{1,2}(?:[.,]\d)?)|(minuto\s+\d+(?:[.,]\d+)?(?:\s*(?:y|con)\s*\d+(?:[.,]\d+)?(?:\s*(?:segundos?|s)\b)?)?)|(\d+(?:[.,]\d+)?\s*(?:minutos?|min)\b(?:\s*(?:y\s*)?\d+(?:[.,]\d+)?\s*(?:segundos?|seg|s)\b)?)|(segundo\s+\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?\s*(?:segundos?|seg|s)\b)/g
/** «del minuto 1 al 2», «desde 0:30 hasta 1:00», «entre el segundo 5 y el 10»: a range written inside the instruction. */
export function parseSpan(raw: string): Range | null {
  const s = fold(raw)
  const toks = [...s.matchAll(TIME_TOKEN)].map(m => ({ i: m.index ?? 0, len: m[0].length, ms: parseTime(m[0]) })).filter(t => t.ms !== null) as Array<{ i: number; len: number; ms: number }>
  // «del minuto 1 al 2», «del segundo 4 al 8»: the second end is a bare number in the unit of the first.
  if (toks.length >= 1) {
    const a = toks[0], word = s.slice(a.i, a.i + a.len)
    const m = /^\s+(?:al|hasta(?: el)?|y(?: el)?|a)\s+(\d+(?:[.,]\d+)?)\b(?!\s*(?::|minutos?|min|segundos?|seg|s\b))/.exec(s.slice(a.i + a.len))
    if (m && (toks.length < 2 || toks[1].i > a.i + a.len + m[0].length)) {
      const n = Number(m[1].replace(',', '.'))
      const unit = /minuto|minutos?|min\b/.test(word) ? 60000 : /segundo|segundos?|seg|s\b/.test(word) ? 1000 : word.includes(':') ? 1000 : 0
      if (unit) toks.splice(1, 0, { i: a.i + a.len + m[0].length - m[1].length, len: m[1].length, ms: Math.round(n * unit) })
    }
  }
  if (toks.length < 2) return null
  const [a, b] = toks
  const before = s.slice(Math.max(0, a.i - 14), a.i), between = s.slice(a.i + a.len, b.i)
  if (!/\b(del?|desde|entre)\b(\s+(el|la))?\s*$/.test(before) || !/^\s*(?:(?:y|al?|hasta)(?:\s+(?:el|la))?)\s*$/.test(between)) return null
  return a.ms < b.ms ? { startMs: a.ms, endMs: b.ms } : null
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
  const selClips = (ctx.selectedItems ?? []).filter(r => r.kind === 'clip' && c.clips.some(k => k.id === r.id)).map(r => r.id)
  if (selClips.length > 1) { const ord = c.clips.filter(k => selClips.includes(k.id)).map(k => k.id); return { ids: ord, label: `los ${ord.length} clips seleccionados` } }
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

const TRANSITION_NAMES: Record<Transition, string> = { fade: 'fundido a negro', fade_white: 'fundido a blanco', dissolve: 'disolvencia', slide: 'deslizar', wipe: 'cortinilla', zoom: 'zoom de entrada', zoom_out: 'zoom de salida', cut: 'corte seco', blur: 'desenfoque', slide_up: 'deslizar hacia arriba', wipe_down: 'cortinilla vertical', flash: 'destello de luz' }
const TRANS: Array<[RegExp, Transition]> = [[/destello|flash|transicion de luz|luz suave/, 'flash'], [/fundido a blanco|a blanco/, 'fade_white'], [/zoom de salida|alejamiento/, 'zoom_out'],[/desenfoque|borroso/, 'blur'], [/deslizar hacia arriba|deslizamiento vertical/, 'slide_up'], [/cortinilla vertical|barrido vertical/, 'wipe_down'], [/disolvencia|fundido encadenado|crossfade|transicion suave|suave/, 'dissolve'], [/fundido( a negro)?/, 'fade'], [/deslizar|deslizamiento|slide/, 'slide'], [/cortinilla|barrido|wipe/, 'wipe'], [/transicion de zoom|zoom de transicion/, 'zoom'], [/corte seco|corte directo|sin transicion/, 'cut']]

/** Runs one instruction. Several can be chained with «y luego», «después» or «;». */
export function runInstruction(c0: Composition, text: string, ctx: CommandContext): CommandResult {
  const parts = text.split(/\s*(?:;|\by luego\b|\by despues\b|\bdespues\b|\.\s+)\s*/i).map(t => t.trim()).filter(Boolean)
  if (!parts.length) return { ok: false, message: 'Escribe una instrucción.' }
  let c = c0
  const done: string[] = []
  const watch: Watch[] = []
  let nav: Pick<Extract<CommandResult, { ok: true }>, 'playheadMs' | 'range' | 'history' | 'saveStyle'> = {}
  for (const part of parts) {
    const span = parseSpan(part)
    const r = runOne(c, part, span ? { ...ctx, range: span } : ctx, span)
    if (!r.ok) return { ok: false, message: parts.length > 1 ? `«${part}»: ${r.message}` : r.message }
    c = r.composition; done.push(...r.done); watch.push(...(r.watch ?? []))
    if (r.playheadMs !== undefined) nav = { ...nav, playheadMs: r.playheadMs }
    if (r.range !== undefined) nav = { ...nav, range: r.range }
    if (r.history) nav = { ...nav, history: r.history }
    if (r.saveStyle) nav = { ...nav, saveStyle: r.saveStyle }
  }
  return { ok: true, composition: c, done, watch, ...nav }
}

function runOne(c: Composition, text: string, ctx: CommandContext, span: Range | null = null): CommandResult {
  const s = fold(text)
  const total = totalDurationMs(c)
  const P = ctx.prefs ?? DEFAULT_PREFS
  let watch: Watch[] = []
  const ok = (composition: Composition, ...d: string[]): CommandResult => ({ ok: true, composition, done: d, watch })
  const newId = <T extends { id: string }>(before: T[] | undefined, after: T[] | undefined) => (after ?? []).find(x => !(before ?? []).some(y => y.id === x.id))?.id
  const fail = (message: string): CommandResult => ({ ok: false, message })

  const freeSel = (ctx.selectedItems ?? []).filter(r => r.kind !== 'clip')
  const kindWord = (): AudioClip['kind'] | null => /\b(musica|cancion)\b/.test(s) ? 'music' : /\b(voz|voces|narracion)\b/.test(s) ? 'voice' : /\befectos?\b/.test(s) ? 'sfx' : null
  const overlaps = (a: AudioClip, r: Range) => { const s0 = audioStartMs(c, a); return s0 < r.endMs && s0 + a.durationMs > r.startMs }

  // ---- History: «deshaz», «rehaz»
  if (/^(deshaz|deshacer|anula|vuelve atras)\b/.test(s)) return { ok: true, composition: c, done: ['Deshecho el último cambio.'], history: 'undo' }
  if (/^(rehaz|rehacer)\b/.test(s)) return { ok: true, composition: c, done: ['Rehecho.'], history: 'redo' }

  // ---- Navigation: «ve al minuto 2», «lleva el cabezal a 1:30», «selecciona del 0:10 al 0:20», «quita la selección»
  if (/^(ve|ir|vete|salta|lleva el cabezal|pon el cabezal|mueve el cabezal)\b/.test(s)) {
    const t = parseTime(s)
    if (t === null) return fail('Dime a qué momento: por ejemplo, ve al minuto 2.')
    return { ok: true, composition: c, done: [`Cabezal en ${fmt(Math.min(t, total))}.`], playheadMs: Math.min(t, total) }
  }
  if (/^(selecciona|marca)\b/.test(s) && span) return { ok: true, composition: c, done: [`Fragmento ${fmt(span.startMs)}–${fmt(span.endMs)} marcado.`], range: { startMs: span.startMs, endMs: Math.min(span.endMs, total) } }
  if (/^(quita|borra|deshaz) (la )?seleccion\b/.test(s)) return { ok: true, composition: c, done: ['Selección quitada.'], range: null }

  // ---- Animating one object inside a photo needs a mask or AI video: say so instead of faking it.
  if (/\b(anima|mueve|haz que se mueva|que se muevan?|parpadee|ondee)\b/.test(s) && /\b(solo|solamente|unicamente|solo la|solo el)\b/.test(s) && !/\b(capa|superposicion|texto|titulo|clip)\b/.test(s)) {
    return fail('Animar solo una parte de una foto (la luz de las velas, el agua, el humo…) no se puede con transformaciones de edición: moverían o iluminarían la imagen entera. Haría falta separar esa parte en su propia capa (recortada) o generar vídeo con IA, que no está activado. Puedo hacer un zoom o una panorámica lenta de toda la foto, o animar una capa que hayas recortado.')
  }

  // ---- Save the style of this montage: «guarda este estilo (como «Lofi suave»)»
  if (/\b(guarda|guardar|crea|memoriza)\b/.test(s) && /\bestilo\b/.test(s)) {
    const name = /[«"“']([^»"”']+)[»"”']/.exec(text)?.[1]?.trim() || `Mi estilo ${new Date().toLocaleDateString()}`
    return { ok: true, composition: c, done: [`Midiendo este montaje para guardarlo como estilo «${name}»…`], saveStyle: name }
  }

  // ---- Markers: «pon un marcador (aquí / en 1:20) llamado «Intro»»
  if (/\b(marcador|marca aqui)\b/.test(s) && /\b(pon|anade|crea|marca|mete)\b/.test(s)) {
    const at = parseTime(s) ?? ctx.playheadMs
    const label = /[«"“']([^»"”']+)[»"”']/.exec(text)?.[1]?.trim() ?? ''
    return ok(addMarker(c, at, label), `Marcador${label ? ` «${label}»` : ''} en ${fmt(at)}.`)
  }

  // ---- Overlays: «pon esta imagen encima del vídeo durante 8 segundos (en la esquina superior derecha)»
  const corner = (): Partial<Transform> | null => {
    if (/\b(pantalla completa|toda la pantalla|a pantalla)\b/.test(s)) return { x: 0.5, y: 0.5, scale: 1 }
    const top = /\b(arriba|superior)\b/.test(s), bottom = /\b(abajo|inferior)\b/.test(s), left = /\bizquierd/.test(s), right = /\bderech/.test(s)
    if (/\b(esquina|pip|ventana)\b/.test(s) || ((top || bottom) && (left || right))) return { x: left ? 0.2 : 0.8, y: top ? 0.22 : 0.78, scale: 0.3 }
    if (/\b(centro|centrada|centrado|en medio)\b/.test(s)) return { x: 0.5, y: 0.5 }
    if (top) return { y: 0.22 }
    if (bottom) return { y: 0.78 }
    if (left) return { x: 0.25 }
    if (right) return { x: 0.75 }
    return null
  }
  const mentionsVisual = /\b(imagen|foto|logo|video|clip|grafico|sticker)\b/.test(s)
  if (/\b(pon|anade|mete|coloca|superpon|agrega)\b/.test(s) && mentionsVisual && /\b(encima|sobre|superpuest\w*|superpon\w*|por encima|esquina|pip|capa)\b/.test(s)) {
    const a = findAsset(text, s, ctx, ['image', 'thumbnail', 'video'])
    if (!a) return fail('Selecciona la imagen o el vídeo en el panel de materiales (o escribe su nombre entre comillas).')
    const at = span ? span.startMs : timeAfter(s, /\b(?:en|desde|a partir de)\b(?: el)?/) ?? ctx.range?.startMs ?? ctx.playheadMs
    const dur = span ? span.endMs - span.startMs : timeAfter(s, /\bdurante\b/) ?? (a.type === 'video' && a.durationMs ? a.durationMs : 5000)
    const r = addOverlay(c, { assetId: a.id, startMs: at, durationMs: dur, transform: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, opacity: 1, ...(corner() ?? {}) } })
    return ok(r.composition, `«${a.label}» encima del vídeo de ${fmt(at)} a ${fmt(at + dur)}${corner() ? ' en la posición pedida' : ''}.`)
  }
  // Instructions about the selected overlay: position, size, rotation, opacity, movement.
  const selOv = (ctx.selectedItems ?? []).filter(r => r.kind === 'overlay').map(r => (c.overlays ?? []).find(o => o.id === r.id)).filter((o): o is NonNullable<typeof o> => !!o)
  const aboutLayer = selOv.length > 0 && /\b(capa|superposicion|imagen|logo|esto|esta|este)\b/.test(s)
  if (aboutLayer) {
    const o = selOv[0]
    const local = Math.min(Math.max(ctx.playheadMs - o.startMs, 0), o.durationMs)
    const now = transformAt({ ...o.transform }, o.keyframes, local)
    if (/\bde (izquierda a derecha|derecha a izquierda|arriba a abajo|abajo a arriba)\b/.test(s) || /\b(se mueva|que se desplace|que cruce)\b/.test(s)) {
      const [k, a0, a1] = /izquierda a derecha/.test(s) ? ['x', 0.15, 0.85] as const : /derecha a izquierda/.test(s) ? ['x', 0.85, 0.15] as const : /arriba a abajo/.test(s) ? ['y', 0.15, 0.85] as const : ['y', 0.85, 0.15] as const
      let next = updateOverlay(c, o.id, { keyframes: undefined })
      next = setKeyframe(next, o.id, 0, { [k]: a0 }); next = setKeyframe(next, o.id, o.durationMs, { [k]: a1 })
      return ok(next, `La capa se desplaza ${/izquierda a derecha/.test(s) ? 'de izquierda a derecha' : /derecha a izquierda/.test(s) ? 'de derecha a izquierda' : /arriba a abajo/.test(s) ? 'de arriba abajo' : 'de abajo arriba'} durante ${fmt(o.durationMs)} (fotogramas clave).`)
    }
    const patch: Partial<Transform> = { ...(corner() ?? {}) }
    if (/\b(mas grande|agranda|aumenta|amplia)\b/.test(s)) patch.scale = Math.min(2, now.scale * 1.3)
    if (/\b(mas pequen\w*|reduce|achica|encoge)\b/.test(s)) patch.scale = Math.max(0.05, now.scale / 1.3)
    const deg = /gira\w*\s+(-?\d+)/.exec(s)?.[1]
    if (deg) patch.rotation = Number(deg)
    const op = /\b(opacidad|transparencia|transparente)\b/.test(s) ? percent(s) ?? (/\btransparen/.test(s) ? 0.5 : null) : null
    if (op !== null) patch.opacity = Math.min(1, Math.max(0, op))
    if (Object.keys(patch).length) {
      const next = o.keyframes?.length ? setKeyframe(c, o.id, local, { ...now, ...patch }) : updateOverlay(c, o.id, { transform: { ...o.transform, ...patch } })
      return ok(next, `Capa: ${[patch.x !== undefined || patch.y !== undefined ? 'nueva posición' : '', patch.scale !== undefined ? `tamaño ${Math.round(patch.scale * 100)} %` : '', patch.rotation !== undefined ? `${patch.rotation}°` : '', patch.opacity !== undefined ? `opacidad ${Math.round(patch.opacity * 100)} %` : ''].filter(Boolean).join(', ')}.`)
    }
  }

  // ---- Picture filters: «blanco y negro», «más brillo», «más contraste», «filtro cálido», «desenfoca»
  const preset = /\b(blanco y negro|byn|monocromo)\b/.test(s) ? 'mono' : /\b(filtro )?(calido|calida)\b/.test(s) ? 'warm' : /\b(filtro )?(vivo|vivos|colores vivos|saturado)\b/.test(s) ? 'vivid' : /\b(dramatico|cine|cinematografico)\b/.test(s) && /\b(filtro|aspecto|look)\b/.test(s) ? 'dramatic' : /\b(desvaido|vintage|apagado)\b/.test(s) ? 'faded' : /\b(sin filtro|quita (el|los) filtros?|color original)\b/.test(s) ? 'none' : null
  const tweak = /\b(mas|sube el|aumenta el) brillo\b/.test(s) ? ['brightness', 1.2] as const : /\b(menos|baja el) brillo\b|\boscurece\b/.test(s) ? ['brightness', 0.8] as const : /\b(mas|sube el) contraste\b/.test(s) ? ['contrast', 1.25] as const : /\b(menos|baja el) contraste\b/.test(s) ? ['contrast', 0.8] as const : /\b(mas|sube la) saturacion\b/.test(s) ? ['saturation', 1.3] as const : /\b(menos|baja la) saturacion\b/.test(s) ? ['saturation', 0.7] as const : /\b(desenfoca|difumina|borroso)\b/.test(s) && !/\btransicion\b/.test(s) ? ['blur', 1.5] as const : null
  if (preset || tweak) {
    const apply = (f: Filters | null | undefined): Filters | null => {
      if (preset) return preset === 'none' ? null : FILTER_PRESETS[preset].f
      const base = f ?? NO_FILTERS
      const [k, v] = tweak!
      const n = { ...base, [k]: k === 'blur' ? Math.min(5, base.blur + v) : Math.min(3, Math.max(0, base[k] * v)) }
      return n.brightness === 1 && n.contrast === 1 && n.saturation === 1 && n.blur === 0 ? null : n
    }
    const what = preset ? (preset === 'none' ? 'sin filtro' : FILTER_PRESETS[preset].label.toLowerCase()) : ({ brightness: tweak![1] > 1 ? 'más brillo' : 'menos brillo', contrast: tweak![1] > 1 ? 'más contraste' : 'menos contraste', saturation: tweak![1] > 1 ? 'más saturación' : 'menos saturación', blur: 'desenfoque' } as Record<string, string>)[tweak![0]]
    if (selOv.length && !/\b(todo|clip|video principal)\b/.test(s)) {
      const ids = new Set(selOv.map(o => o.id))
      return ok({ ...c, overlays: (c.overlays ?? []).map(o => (ids.has(o.id) ? { ...o, filters: apply(o.filters) } : o)) }, `Capa: ${what}.`)
    }
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('Selecciona un clip o una capa, marca un fragmento o pon el cabezal sobre un clip.')
    const ids = new Set(sc.ids)
    return ok({ ...c, clips: c.clips.map(k => (ids.has(k.id) ? { ...k, filters: apply(k.filters) } : k)) }, `${what[0].toUpperCase()}${what.slice(1)} en ${sc.label}.`)
  }

  // ---- Effects on every cut: «pon el efecto «whoosh» en los cortes», «quita los efectos de los cortes»
  if (/\b(cortes|cada corte|cada cambio)\b/.test(s) && /\b(efecto|efectos|sonido|whoosh)\b/.test(s)) {
    if (/^(quita|elimina|borra)\b/.test(s)) { const n = cutSfxClips(c).length; return n ? ok(removeCutSfx(c), `Quitados ${n} efectos de los cortes.`) : fail('No hay efectos puestos en los cortes.') }
    const a = findAsset(text, s, ctx, ['sfx', 'audio'])
    if (!a) return fail('No encuentro ese efecto en los materiales del proyecto (súbelo como «Efecto»).')
    const r = setCutSfx(c, { ...defaultCutSfx(a.id), volume: percent(s) ?? P.sfxVolume })
    return r.added ? ok(r.composition, `Efecto «${a.label}» en ${r.added} corte${r.added === 1 ? '' : 's'}.`) : fail('No hay cortes donde ponerlo.')
  }

  // ---- Music under the voice: «baja la música cuando hable», «no bajes la música»
  if (/\bmusica\b/.test(s) && /\b((cuando|mientras) (habla|hable|hablo|hay voz|suena la voz|se habla|(empieza|comienza|entra) la voz)|bajo la voz|con la voz|al hablar|ducking)\b/.test(s)) {
    const on = !/\b(no|nunca|sin)\b/.test(s)
    return ok({ ...c, duckMusic: on }, on ? (c.duckMusic ? 'La música ya baja sola cuando suena la voz (estaba activado; no había que cambiar nada).' : 'La música bajará cuando suene la voz.') : 'La música ya no baja con la voz.')
  }
  if (/\b(no bajes la musica|musica constante|musica siempre igual)\b/.test(s)) return ok({ ...c, duckMusic: false }, 'La música ya no baja con la voz.')

  // ---- Fades of an audio track: «que la música entre poco a poco», «fundido de salida de 3 segundos en la voz»
  const fadeIn = /\b(entre|entrada|empiece|aparezca|fade ?in|suba poco a poco|arranque)\b/.test(s)
  const fadeOut = /\b(salga|salida|termine|acabe|desaparezca|fade ?out|se apague|final)\b/.test(s)
  if ((fadeIn || fadeOut) && /\b(poco a poco|suave|gradual|progresiv\w*|fundido|fade|despacio)\b/.test(s) && (kindWord() || /\b(audio|sonido)\b/.test(s))) {
    const kind = kindWord() ?? 'music'
    const len = timeAfter(s, /\b(?:de|durante)\b/) ?? 2000
    const target = (c.audioClips ?? []).filter(a => a.kind === kind && (!ctx.range || overlaps(a, ctx.range)))
    if (!target.length) return fail(`No hay ${kind === 'music' ? 'música' : kind === 'voice' ? 'voz' : 'efectos'} en la pista de audio.`)
    const ids = new Set(target.map(a => a.id))
    const first = target.reduce((x, y) => (audioStartMs(c, y) < audioStartMs(c, x) ? y : x)).id, last = target.reduce((x, y) => (audioStartMs(c, y) + y.durationMs > audioStartMs(c, x) + x.durationMs ? y : x)).id
    const audioClips = (c.audioClips ?? []).map(a => (!ids.has(a.id) ? a : { ...a, ...(fadeIn && (a.id === first || ctx.range) ? { fadeInMs: Math.min(len, a.durationMs / 2) } : {}), ...(fadeOut && (a.id === last || ctx.range) ? { fadeOutMs: Math.min(len, a.durationMs / 2) } : {}) }))
    return ok({ ...c, audioClips }, `${kind === 'music' ? 'Música' : kind === 'voice' ? 'Voz' : 'Efectos'}: ${[fadeIn ? 'entrada' : '', fadeOut ? 'salida' : ''].filter(Boolean).join(' y ')} gradual de ${fmt(len)}.`)
  }

  // ---- Remove audio: «quita la música», «elimina la voz del minuto 2 al 3»
  if (/^(quita|elimina|borra|saca)\b/.test(s) && kindWord() && !/\b(volumen|subtitulos?|efectos de los cortes)\b/.test(s)) {
    const kind = kindWord()!
    const gone = (c.audioClips ?? []).filter(a => a.kind === kind && (!ctx.range || overlaps(a, ctx.range)))
    const global = kind === 'music' && c.musicAssetId && !ctx.range
    if (!gone.length && !global) return fail(`No hay ${kind === 'music' ? 'música' : kind === 'voice' ? 'voz' : 'efectos'} que quitar${ctx.range ? ' en esa parte' : ''}.`)
    if (ctx.range) {
      // Inside a range only that stretch goes silent (the clip keeps playing before and after).
      const r = ctx.range
      const audioClips = (c.audioClips ?? []).map(a => (gone.includes(a) ? setLevelBetween(a, r.startMs - audioStartMs(c, a), r.endMs - audioStartMs(c, a), 0, 150) : a))
      return ok({ ...c, audioClips }, `${kind === 'music' ? 'Música' : kind === 'voice' ? 'Voz' : 'Efectos'} en silencio de ${fmt(r.startMs)} a ${fmt(r.endMs)}.`)
    }
    const ids = new Set(gone.map(a => a.id))
    return ok({ ...c, audioClips: (c.audioClips ?? []).filter(a => !ids.has(a.id)), ...(global ? { musicAssetId: null } : {}) }, `Quitad${kind === 'music' ? 'a la música' : kind === 'voice' ? 'a la voz' : 'os los efectos'} (${gone.length + (global ? 1 : 0)}).`)
  }

  // ---- Length of the whole video: «haz que el vídeo dure exactamente 30 segundos». Photos absorb the difference (their length is free);
  // with only videos the last one is shortened. Sound that would run past the new end is cut there.
  if (/\b(dure|duracion|dura|mida)\b/.test(s) && /\b(el video|el montaje|todo el video|todo el montaje|en total|el proyecto|video entero|montaje entero)\b/.test(s) && !/\b(texto|titulo|musica|voz|efecto|clip|escena)\b/.test(s)) {
    const t = timeAfter(s, /\b(?:a|en|dure|dura|de|exactamente)\b/) ?? parseTime(s)
    if (t === null || t < MIN_CLIP_MS) return fail('Dime cuánto: por ejemplo, que el vídeo dure 30 segundos.')
    if (!c.clips.length) return fail('El montaje no tiene clips todavía.')
    const total = totalDurationMs(c)
    let diff = t - total
    const photos = c.clips.filter(k => !ctx.isVideo(k))
    let next = c
    if (diff !== 0 && photos.length) {
      const sum = photos.reduce((a, k) => a + k.durationMs, 0)
      photos.forEach((k, i) => {
        const want = i === photos.length - 1 ? k.durationMs + diff : Math.round(k.durationMs + (t - total) * k.durationMs / sum)
        const d = Math.min(Math.max(want, MIN_CLIP_MS), MAX_CLIP_MS)
        diff -= d - k.durationMs
        next = updateClip(next, k.id, { durationMs: d })
      })
    } else if (diff < 0) {
      const last = c.clips[c.clips.length - 1]
      const d = Math.max(MIN_CLIP_MS, last.durationMs + diff); diff -= d - last.durationMs
      next = updateClip(next, last.id, { durationMs: d })
    }
    const got = totalDurationMs(next)
    if (got !== t) return fail(photos.length ? `No llego a ${fmt(t)} sin pasar del límite por clip: ahora dura ${fmt(total)}. Añade otra foto o ajusta los clips a mano.` : `Los vídeos no tienen más material: para que dure ${fmt(t)} añade una foto o alarga un vídeo con cámara lenta.`)
    const cut = (next.audioClips ?? []).map(a => { const st = audioStartMs(next, a); return st >= t ? null : st + a.durationMs > t ? { ...a, durationMs: t - st } : a }).filter((a): a is AudioClip => !!a)
    next = { ...next, audioClips: cut }
    return ok(next, `El vídeo dura ahora exactamente ${fmt(t)} (antes ${fmt(total)})${photos.length ? '; se han ajustado las fotos' : ''}. El sonido que pasaba del final se corta ahí.`)
  }

  // ---- Clip length: «que dure 4 segundos», «acorta este clip a 3 segundos», «alarga las imágenes a 6 s»
  if (/\b(que dure|que duren|dure|duren|duracion|acorta|alarga|estira)\b/.test(s) && !/\b(texto|titulo|musica|voz|efecto)\b/.test(s)) {
    const t = timeAfter(s, /\b(?:a|en|dure|duren|de)\b/) ?? parseTime(s)
    if (t === null) return fail('Dime cuánto: por ejemplo, que dure 4 segundos.')
    const sc = /\b(imagenes|fotos)\b/.test(s) ? { ids: c.clips.filter(k => !ctx.isVideo(k)).map(k => k.id), label: 'las imágenes' } : scope(c, s, ctx)
    if (!sc.ids.length) return fail('Selecciona un clip o pon el cabezal sobre él.')
    const d = Math.min(Math.max(t, MIN_CLIP_MS), MAX_CLIP_MS)
    return ok(sc.ids.reduce((x, id) => updateClip(x, id, { durationMs: d }), c), `${sc.label[0].toUpperCase()}${sc.label.slice(1)}: ${fmt(d)} cada uno.`)
  }

  // ---- Move a clip: «mueve este clip al principio», «pasa la escena al final»
  if (/^(mueve|pasa|lleva|coloca|pon)\b/.test(s) && /\b(clip|escena|esto|este|plano|video|foto|fotografia|imagen)\b/.test(s) && /\b(al principio|al inicio|al comienzo|al final)\b/.test(s)) {
    const sc = scope(c, s, ctx)
    if (sc.ids.length !== 1) return fail('Selecciona un solo clip para moverlo.')
    const toEnd = /\bal final\b/.test(s)
    return ok(moveClip(c, sc.ids[0], toEnd ? c.clips.length : 0), `${sc.label[0].toUpperCase()}${sc.label.slice(1)} movido ${toEnd ? 'al final' : 'al principio'}.`)
  }

  // ---- Texts and titles: «pon el título "X" en el segundo 5 durante 3 segundos (arriba)»
  if (/\b(texto|titulo|rotulo)\b/.test(s) && /\b(pon|anade|escribe|mete|agrega|crea)\b/.test(s)) {
    const content = /[«"“']([^»"”']+)[»"”']/.exec(text)?.[1]?.trim()
    if (!content) return fail('Pon el texto entre comillas, por ejemplo: pon el título «Capítulo 1».')
    const at = timeAfter(s, /\b(?:en|desde|a partir de)\b(?: el)?/) ?? ctx.range?.startMs ?? ctx.playheadMs
    const givenDur = timeAfter(s, /\bdurante\b/) ?? (ctx.range ? ctx.range.endMs - ctx.range.startMs : null)
    const dur = givenDur ?? P.textMs
    const position = /\barriba\b/.test(s) ? 'top' : /\babajo\b/.test(s) ? 'bottom' : 'center'
    const isTitle = /\btitulo\b/.test(s)
    const next = addTextClip(c, { content, startMs: Math.min(at, Math.max(0, total - 300)), durationMs: dur, position, sizePct: isTitle ? P.titleSizePct : P.textSizePct, animation: 'fade', font: 'sans', color: '#ffffff' })
    const tid = newId(c.textClips, next.textClips)
    if (tid) watch = [...(givenDur === null ? [{ key: 'textMs' as const, value: dur, target: { kind: 'text' as const, id: tid, field: 'durationMs' as const } }] : []), { key: isTitle ? 'titleSizePct' as const : 'textSizePct' as const, value: isTitle ? P.titleSizePct : P.textSizePct, target: { kind: 'text' as const, id: tid, field: 'sizePct' as const } }]
    return ok(next,
      `${isTitle ? 'Título' : 'Texto'} «${content}» en ${fmt(at)} durante ${fmt(dur)}.`)
  }

  // ---- Music / voice / effect on the audio track: «pon esta música desde el minuto 2 (hasta el minuto 4) (al 30 %)»
  const placeVerb = /\b(pon|ponle|anade|mete|usa|agrega|coloca|inserta)\b/.test(s)
  const audioWord = /\b(musica|cancion|voz|narracion|efecto|sonido)\b/.test(s)
  const placementHint = Boolean(span) || /\b(desde|hasta|a partir|esta|este|minuto|segundo)\b/.test(s) || /\d+:\d+/.test(s) || /[«"“']/.test(text)
  if (placeVerb && audioWord && (placementHint || percent(s) === null)) {
    const kind: AudioClip['kind'] = /\b(voz|narracion)\b/.test(s) ? 'voice' : /\b(efecto|sonido)\b/.test(s) ? 'sfx' : 'music'
    const types = kind === 'music' ? ['music', 'audio'] : kind === 'voice' ? ['voice', 'audio'] : ['sfx', 'audio']
    const a = findAsset(text, s, ctx, types)
    if (!a) return fail(kind === 'music' ? 'No encuentro esa música en los materiales del proyecto. Selecciónala en el panel o escribe su nombre entre comillas.' : 'No encuentro ese audio en los materiales del proyecto.')
    const start = span ? span.startMs : timeAfter(s, /\b(?:desde|a partir de|en)\b(?: el)?/) ?? ctx.range?.startMs ?? 0
    if (start >= total) return fail(`El montaje dura ${fmt(total)}: no se puede empezar en ${fmt(start)}.`)
    const end = /\bhasta el final\b/.test(s) ? total : span ? span.endMs : timeAfter(s, /\bhasta\b(?: el)?/) ?? (ctx.range && !/\bdesde\b/.test(s) ? ctx.range.endMs : null)
    const own = a.durationMs ?? null
    const durationMs = Math.max(500, Math.min(end !== null ? end - start : own ?? total - start, total - start, own ?? Infinity))
    const prefKey = kind === 'music' ? 'musicVolume' as const : kind === 'voice' ? 'voiceVolume' as const : 'sfxVolume' as const
    const vol = percent(s) ?? P[prefKey]
    const next = addAudioClip(c, { assetId: a.id, kind, linkedClipId: null, offsetMs: 0, startMs: start, trimInMs: 0, durationMs, volume: vol, muted: false })
    const aid = newId(c.audioClips, next.audioClips)
    if (aid && percent(s) === null) watch = [{ key: prefKey, value: vol, target: { kind: 'audio', id: aid } }]
    return ok(next,
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
    // With a marked fragment, the level changes only there (volume automation with short ramps); the rest keeps its level.
    if (ctx.range) {
      const r = ctx.range
      let k = 0
      const target = (a: AudioClip) => mute === true ? 0 : mute === false ? 1 : Math.min(2, Math.max(0, pct !== null ? pct / Math.max(0.01, a.volume) : envelopeAt(a, Math.max(0, r.startMs - audioStartMs(c, a))) * (rel ?? 1)))
      const audioClips = (c.audioClips ?? []).map(a => {
        const s0 = audioStartMs(c, a)
        if (a.kind !== track || s0 >= r.endMs || s0 + a.durationMs <= r.startMs) return a
        k++
        return setLevelBetween(a, r.startMs - s0, r.endMs - s0, target(a))
      })
      const name = track === 'music' ? 'Música' : track === 'voice' ? 'Voz' : 'Efectos'
      return k ? ok({ ...c, audioClips }, `${name} ${mute ? 'en silencio' : mute === false ? 'activada' : pct !== null ? `al ${Math.round(pct * 100)} %` : rel! > 1 ? 'más alta' : 'más baja'} solo en el fragmento ${fmt(r.startMs)}–${fmt(r.endMs)} (automatización de volumen en ${k} clip${k === 1 ? '' : 's'}).`) : fail(`No hay ${name.toLowerCase()} en la pista dentro del fragmento.`)
    }
    let n = 0
    const audioClips = (c.audioClips ?? []).map(a => (a.kind === track ? (n++, { ...a, ...(mute !== null ? { muted: mute } : { volume: setVol(a.volume), muted: false }) }) : a))
    let next: Composition = { ...c, audioClips }
    if (track === 'music' && c.musicAssetId) { next = { ...next, musicVolume: Math.min(1, mute ? 0 : setVol(c.musicVolume)) }; n++ }
    const name = track === 'music' ? 'Música' : track === 'voice' ? 'Voz' : 'Efectos'
    return n ? ok(next, `${name}: ${mute ? 'silenciada' : mute === false ? 'activada' : pct !== null ? `al ${Math.round(pct * 100)} %` : rel! > 1 ? 'un 30 % más alta' : 'un 40 % más baja'} (${n} pista${n === 1 ? '' : 's'}).`) : fail(`No hay ${name.toLowerCase()} en el montaje.`)
  }

  // ---- Delete: «borra este fragmento», «elimina el clip»
  if (span && /^(corta|recorta|quita|elimina|borra|suprime)\b/.test(s) && !kindWord()) {
    const r = deleteRange(c, span)
    return r.removedMs ? ok(r.composition, `Eliminado de ${fmt(span.startMs)} a ${fmt(span.endMs)} (${fmt(r.removedMs)}); lo que venía después se adelanta y el audio sigue sincronizado.`) : fail('En ese tramo no hay clips que quitar.')
  }
  if (span && /^(separa|aisla|divide)\b/.test(s)) { const r = isolateRange(c, span); return ok(r.composition, `Separado de ${fmt(r.range.startMs)} a ${fmt(r.range.endMs)} en ${r.ids.length} clip${r.ids.length === 1 ? '' : 's'} propios.`) }
  if (/^(borra|elimina|quita|suprime)\b/.test(s) && freeSel.length && !ctx.selectedClipId && !ctx.range && /\b(esto|esta|este|capa|seleccion|texto|imagen|logo)\b/.test(s)) return ok(deleteItems(c, freeSel), `Eliminado${freeSel.length === 1 ? '' : 's'} ${freeSel.length} elemento${freeSel.length === 1 ? '' : 's'}.`)
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
  if (/^(duplica|repite|copia)\b/.test(s) && freeSel.length && !ctx.selectedClipId) {
    const r = duplicateItems(c, freeSel)
    return ok(r.composition, `Duplicado${r.refs.length === 1 ? '' : 's'} ${r.refs.length} elemento${r.refs.length === 1 ? '' : 's'} a continuación.`)
  }
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
  if (cam && !/\btransicion/.test(s)) {
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('Selecciona un clip, marca un fragmento o pon el cabezal sobre un clip.')
    const speedKey = /\b(muy lento|muy suave)\b/.test(s) ? null : /\b(lento|suave|ligero|poco)\b/.test(s) ? 'zoomSlow' as const : /\b(rapido|fuerte|intenso|mucho|dramatico)\b/.test(s) ? 'zoomFast' as const : 'zoomNormal' as const
    const amount = speedKey ? P[speedKey] : Math.max(0.02, P.zoomSlow * 0.6)
    const ids = new Set(sc.ids)
    // «durante ocho segundos»: the movement lasts the whole clip, so a photo takes that length (a video keeps its own).
    const lasting = timeAfter(s, /\bdurante\b/)
    if (lasting !== null && cam !== 'none') {
      const d = Math.min(Math.max(lasting, MIN_CLIP_MS), MAX_CLIP_MS)
      const imgs = c.clips.filter(k => ids.has(k.id) && !ctx.isVideo(k))
      const next = { ...c, clips: c.clips.map(k => (ids.has(k.id) ? { ...k, camera: { kind: cam, amount }, ...(!ctx.isVideo(k) ? { durationMs: d } : {}) } : k)) }
      return ok(next, `${cam === 'zoom_in' ? 'Zoom' : 'Movimiento'} ${speedKey === 'zoomFast' ? 'rápido' : 'lento'} durante ${fmt(d)} en ${sc.label}${imgs.length ? ` (${imgs.length === 1 ? 'la foto dura' : 'las fotos duran'} ahora ${fmt(d)})` : ''}.`)
    }
    if (speedKey && cam !== 'none') watch = [{ key: speedKey, value: amount, target: { kind: 'clips', ids: sc.ids } }]
    return ok({ ...c, clips: c.clips.map(k => (ids.has(k.id) ? { ...k, camera: { kind: cam, amount } } : k)) },
      cam === 'none' ? `Sin movimiento de cámara en ${sc.label}.` : `${({ zoom_in: 'Zoom', zoom_out: 'Alejamiento', pan_left: 'Panorámica a la izquierda', pan_right: 'Panorámica a la derecha', pan_up: 'Subida de cámara', pan_down: 'Bajada de cámara' } as Record<string, string>)[cam]} ${speedKey === 'zoomSlow' || !speedKey ? 'lento' : speedKey === 'zoomFast' ? 'rápido' : ''} en ${sc.label}.`.replace(/\s+en/, ' en'))
  }

  // ---- Transitions
  const tr = TRANS.find(([re]) => re.test(s))?.[1]
  if (tr && /\b(transicion|transiciones|fundido|corte seco|corte directo|disolvencia|cortinilla|deslizar|sin transicion|destello)\b/.test(s)) {
    const sc = scope(c, s, ctx)
    if (!sc.ids.length) return fail('Selecciona un clip o marca un fragmento.')
    // «entre estas fotografías»: the cuts between the chosen clips (not after the last one).
    const ids = new Set(/\bentre\b/.test(s) && sc.ids.length > 1 ? sc.ids.slice(0, -1) : sc.ids)
    const durM = /(\d+(?:[.,]\d+)?)\s*(milisegundos?|ms|segundos?|seg|s)\b/.exec(s)
    const ms = durM ? Math.round(Number(durM[1].replace(',', '.')) * (/^m/.test(durM[2]) ? 1 : 1000)) : null
    if (ms !== null && (ms < 50 || ms > 3000)) return fail('La transición puede durar entre 0,05 y 3 segundos.')
    const name = TRANSITION_NAMES[tr]
    return ok({ ...c, clips: c.clips.map(k => (ids.has(k.id) ? { ...k, transition: tr, ...(ms !== null && tr !== 'cut' ? { transitionMs: ms } : {}) } : k)) }, `Transición «${name}»${ms !== null && tr !== 'cut' ? ` de ${fmt(ms)}` : ''} en ${sc.label}${ids.size !== sc.ids.length ? ` (${ids.size} corte${ids.size === 1 ? '' : 's'} entre ellos)` : ''}.`)
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
  if (/\bsubtitulos?\b/.test(s) && /\b(palabra a palabra|karaoke|dinamicos|grandes|negrita|clasicos|con caja|caja|virales?|vistosos?)\b/.test(s)) {
    const style = /\b(virales?|vistosos?)\b/.test(s) ? 'viral' : /\b(palabra a palabra|karaoke|dinamicos)\b/.test(s) ? 'karaoke' : /\b(grandes|negrita)\b/.test(s) ? 'bold' : 'box'
    return ok({ ...c, subtitles: true, captionStyle: style }, `Subtítulos ${style === 'viral' ? 'virales (2-3 palabras, color y rebote)' : style === 'karaoke' ? 'palabra a palabra' : style === 'bold' ? 'grandes en negrita' : 'clásicos con caja'}.`)
  }
  if (/\bsubtitulos?\b/.test(s)) {
    const on = !/\b(quita|desactiva|sin|oculta|elimina)\b/.test(s)
    // «pon subtítulos en la parte inferior / arriba / en el centro»
    const pos = !on ? null : /\b(arriba|parte superior|superior|en lo alto)\b/.test(s) ? 'top' : /\b(centro|centrados?|en medio|mitad)\b/.test(s) ? 'center' : /\b(abajo|parte inferior|inferior|debajo)\b/.test(s) ? 'bottom' : null
    const next = { ...c, subtitles: on, ...(pos ? { captionPosition: pos === 'bottom' ? undefined : pos } : {}) } as Composition
    const where = pos === 'top' ? ' arriba' : pos === 'center' ? ' en el centro' : pos === 'bottom' ? ' en la parte inferior' : ''
    const cues = compositionCues(c).length > 0
    return ok(next, `Subtítulos ${on ? `activados${where}` : 'desactivados'}.${on && !cues ? ' Ojo: el montaje aún no tiene texto de subtítulos (impórtalos en «Textos» o escríbelos en cada clip).' : ''}`)
  }

  return fail('No he entendido la instrucción.')
}
