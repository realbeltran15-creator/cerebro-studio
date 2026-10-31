/**
 * Canvas drawing of a frame description (scene.ts). Shared by the preview player and the exporter, so both draw the same pixels.
 */
import { TEXT_FONTS, type CaptionPosition, type CaptionStyle, type TextOverlay } from './composition'
import type { TextFrame } from './motion'
import type { Op, VisualOp } from './scene'

export type DrawSource = { src: CanvasImageSource; width: number; height: number }

/** Whether this browser applies canvas filters (brightness, contrast, saturation, blur). Safari does not. */
export function canvasFiltersSupported(ctx?: CanvasRenderingContext2D | null) {
  try { const c = ctx ?? document.createElement('canvas').getContext('2d'); return !!c && 'filter' in c } catch { return false }
}

/** Draws every operation of a frame. `sourceOf` returns the decoded picture of a visual layer, or null when it is not ready (then it is skipped). */
export function drawOps(ctx: CanvasRenderingContext2D, ops: Op[], w: number, h: number, sourceOf: (op: VisualOp) => DrawSource | null) {
  for (const op of ops) {
    if (op.type === 'fill') { ctx.save(); ctx.globalAlpha = op.alpha; ctx.fillStyle = op.color; ctx.fillRect(0, 0, w, h); ctx.restore() }
    else if (op.type === 'visual') drawVisual(ctx, op, w, h, sourceOf(op))
    else if (op.type === 'text') drawText(ctx, op.text, w, h, op.frame)
    else if (op.type === 'caption') drawCaption(ctx, op.text, w, h, op.style, op.progress, op.position)
    else if (op.type === 'hook') drawHook(ctx, op.text, w, h, op.alpha)
  }
}

function filterString(op: Pick<VisualOp, 'filters' | 'grade' | 'blur'>, h: number) {
  const f = op.filters, g = op.grade
  const parts: string[] = []
  if (f && f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f && f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f && f.saturation !== 1) parts.push(`saturate(${f.saturation})`)
  // «Igualar imagen» goes after the owner's own filters (it was measured on the picture as they left it).
  if (g && g.brightness !== 1) parts.push(`brightness(${round4(g.brightness)})`)
  if (g && g.contrast !== 1) parts.push(`contrast(${round4(g.contrast)})`)
  if (g && g.saturation !== 1) parts.push(`saturate(${round4(g.saturation)})`)
  const blur = (f?.blur ?? 0) + op.blur
  if (blur > 0) parts.push(`blur(${Math.round(blur * h / 100 * 10) / 10}px)`)
  return parts.length ? parts.join(' ') : 'none'
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4
/**
 * Colour temperature for «Igualar imagen»: a soft-light wash of warm orange or cool blue over the area just drawn
 * (soft-light keeps black and white and moves the mid-tones, so it does not flatten the picture).
 */
export function drawWarmth(ctx: CanvasRenderingContext2D, warmth: number, x: number, y: number, w: number, h: number) {
  if (!warmth) return
  ctx.save()
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'soft-light'
  ctx.globalAlpha *= Math.min(1, Math.abs(warmth))
  ctx.fillStyle = warmth > 0 ? '#ff8a1e' : '#2a7bff'
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}
export { filterString as visualFilterString }

/** An off-screen canvas for effects that need pixels (chroma key). Null where the platform has none (the Node renderer): the effect is skipped. */
let layerCache: { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null
let layerFactory: ((w: number, h: number) => OffscreenCanvas | HTMLCanvasElement) | null = null
/** For platforms without OffscreenCanvas or a document (the Node renderer passes its own canvas constructor). */
export function setLayerFactory(f: ((w: number, h: number) => OffscreenCanvas | HTMLCanvasElement) | null) { layerFactory = f; layerCache = null }
function layerFor(w: number, h: number) {
  try {
    if (!layerCache || layerCache.canvas.width !== w || layerCache.canvas.height !== h) {
      const canvas = layerFactory ? layerFactory(w, h) : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null
      const ctx = canvas?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      layerCache = canvas && ctx ? { canvas, ctx } : null
    }
  } catch { layerCache = null }
  return layerCache
}

/** Makes the pixels close to the key colour transparent (soft edge). */
export function applyChroma(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, key: { color: string; tolerance: number; softness: number }, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data
  const kr = parseInt(key.color.slice(1, 3), 16), kg = parseInt(key.color.slice(3, 5), 16), kb = parseInt(key.color.slice(5, 7), 16)
  const tol = key.tolerance * 441.67, soft = Math.max(1, key.softness * 441.67)   // 441.67 = longest RGB distance
  for (let p = 0; p < d.length; p += 4) {
    const dist = Math.hypot(d[p] - kr, d[p + 1] - kg, d[p + 2] - kb)
    if (dist <= tol) d[p + 3] = 0
    else if (dist < tol + soft) d[p + 3] = Math.round(d[p + 3] * (dist - tol) / soft)
  }
  ctx.putImageData(img, 0, 0)
}

/** Clips the following drawing to a shape inside the rectangle (x, y, w, h); `invert` keeps what is OUTSIDE the shape. */
export function maskPath(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: { shape: 'ellipse' | 'rounded' | 'rect'; inset: number; invert?: boolean }, x: number, y: number, w: number, h: number) {
  const ix = w * m.inset, iy = h * m.inset, rx = x + ix, ry = y + iy, rw = w - 2 * ix, rh = h - 2 * iy
  ctx.beginPath()
  if (m.invert) ctx.rect(x - w, y - h, w * 3, h * 3)
  if (m.shape === 'ellipse') ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2)
  else if (m.shape === 'rounded') { const r = Math.min(rw, rh) * 0.18; ctx.moveTo(rx + r, ry); ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r); ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r); ctx.arcTo(rx, ry + rh, rx, ry, r); ctx.arcTo(rx, ry, rx + rw, ry, r); ctx.closePath() }
  else ctx.rect(rx, ry, rw, rh)
  ctx.clip(m.invert ? 'evenodd' : 'nonzero')
}

/** One picture layer: crop, fit (cover or a box), rotation, opacity, filters, blend mode, mask, chroma key and the transition transforms. */
export function drawVisual(ctx: CanvasRenderingContext2D, op: VisualOp, w: number, h: number, s: DrawSource | null) {
  if (op.alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, op.alpha)
  if (op.fx?.blend) ctx.globalCompositeOperation = op.fx.blend
  if (op.revealX < 1 || op.revealY < 1) {
    const rw = w * op.revealX, rh = h * op.revealY
    const x = op.revealFrom === 'right' ? w - rw : 0, y = op.revealFrom === 'bottom' ? h - rh : 0
    ctx.beginPath(); ctx.rect(x, y, rw, rh); ctx.clip()
  }
  if (op.offsetX || op.offsetY) ctx.translate(w * op.offsetX, h * op.offsetY)
  if (op.scale !== 1) { ctx.translate(w / 2, h / 2); ctx.scale(op.scale, op.scale); ctx.translate(-w / 2, -h / 2) }
  if (op.backdrop) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h) }
  if (!s || !s.width || !s.height) { ctx.restore(); return }
  // Chroma key needs the pixels: the picture goes to a private layer, the key colour is made transparent there, and the layer is drawn here.
  const layer = op.fx?.chroma ? layerFor(w, h) : null
  if (layer) {
    layer.ctx.save()
    layer.ctx.clearRect(0, 0, w, h)
    drawPicture(layer.ctx as CanvasRenderingContext2D, op, w, h, s)
    layer.ctx.restore()
    applyChroma(layer.ctx, op.fx!.chroma!, w, h)
    ctx.filter = 'none'
    ctx.drawImage(layer.canvas as CanvasImageSource, 0, 0, w, h)
  } else drawPicture(ctx, op, w, h, s)
  ctx.restore()
}

/** The picture itself (crop, fit, rotation, filters, mask) on a context already positioned for the layer. */
function drawPicture(ctx: CanvasRenderingContext2D, op: VisualOp, w: number, h: number, s: DrawSource) {
  const filter = filterString(op, h)
  if (filter !== 'none' && 'filter' in ctx) ctx.filter = filter
  const c = op.crop
  const sx = c ? s.width * c.left : 0, sy = c ? s.height * c.top : 0
  const sw = c ? s.width * (1 - c.left - c.right) : s.width, sh = c ? s.height * (1 - c.top - c.bottom) : s.height
  if (op.fit === 'cover') {
    if (op.rotation) { ctx.translate(w / 2, h / 2); ctx.rotate(op.rotation * Math.PI / 180); ctx.translate(-w / 2, -h / 2) }
    const scale = Math.max(w / sw, h / sh) * op.zoom
    const dw = sw * scale, dh = sh * scale
    if (op.fx?.mask) maskPath(ctx, op.fx.mask, 0, 0, w, h)
    // focusX/focusY pick which part of a larger (or zoomed) source stays in frame (0 = left/top edge, 1 = right/bottom).
    ctx.drawImage(s.src, sx, sy, sw, sh, (w - dw) * op.focusX, (h - dh) * op.focusY, dw, dh)
    if (op.grade?.warmth) drawWarmth(ctx, op.grade.warmth, Math.max(0, (w - dw) * op.focusX), Math.max(0, (h - dh) * op.focusY), Math.min(w, dw), Math.min(h, dh))
  } else if (op.box) {
    const bw = Math.max(1, op.box.scale * w), bh = bw * sh / sw
    ctx.translate(op.box.x * w, op.box.y * h)
    if (op.box.rotation) ctx.rotate(op.box.rotation * Math.PI / 180)
    if (op.fx?.mask) maskPath(ctx, op.fx.mask, -bw / 2, -bh / 2, bw, bh)
    if (op.zoom !== 1) {
      // Ken Burns inside the box: the box stays put and the picture moves inside it.
      ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip()
      const zw = bw * op.zoom, zh = bh * op.zoom
      ctx.drawImage(s.src, sx, sy, sw, sh, -bw / 2 + (bw - zw) * op.focusX, -bh / 2 + (bh - zh) * op.focusY, zw, zh)
    } else ctx.drawImage(s.src, sx, sy, sw, sh, -bw / 2, -bh / 2, bw, bh)
    if (op.grade?.warmth) drawWarmth(ctx, op.grade.warmth, -bw / 2, -bh / 2, bw, bh)
  }
}

/** Where a box layer lands on the frame (for the viewer's handles): centre, size and rotation in pixels. */
export function boxRect(op: Pick<VisualOp, 'box' | 'crop'>, source: { width: number; height: number } | null, w: number, h: number) {
  if (!op.box) return null
  const c = op.crop
  const sw = (source?.width || 16) * (c ? 1 - c.left - c.right : 1), sh = (source?.height || 9) * (c ? 1 - c.top - c.bottom : 1)
  const bw = op.box.scale * w
  return { cx: op.box.x * w, cy: op.box.y * h, w: bw, h: bw * sh / sw, rotation: op.box.rotation }
}

export function drawHook(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, alpha: number) {
  const size = Math.round(w * 0.075)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const lines = wrap(ctx, text.toUpperCase(), w * 0.86)
  const lineH = size * 1.15
  const top = Math.round(h * 0.12)
  ctx.lineWidth = Math.max(4, size * 0.12); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff'
  lines.forEach((l, i) => { ctx.strokeText(l, w / 2, top + i * lineH); ctx.fillText(l, w / 2, top + i * lineH) })
  ctx.restore()
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

export function drawCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, style: CaptionStyle = 'box', progress = 0, position: CaptionPosition = 'bottom') {
  if (style === 'viral') return drawViralCaption(ctx, text, w, h, progress, position)
  if (style !== 'box') return drawBoldCaption(ctx, text, w, h, style === 'karaoke' ? progress : null, position)
  const size = Math.round(Math.min(w, h) * 0.045)
  ctx.font = `600 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
  const lines = wrap(ctx, text, w * 0.84)
  const lineH = size * 1.25
  const boxH = lines.length * lineH + size * 0.6
  const bottom = position === 'top' ? Math.round(h * (w < h ? 0.12 : 0.07)) + boxH : position === 'center' ? (h + boxH) / 2 : h - Math.round(h * (w < h ? 0.18 : 0.07))
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  const boxW = Math.min(w * 0.9, Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 1.2)
  ctx.fillRect((w - boxW) / 2, bottom - boxH, boxW, boxH)
  ctx.fillStyle = '#fff'
  lines.forEach((l, i) => ctx.fillText(l, w / 2, bottom - boxH + size * 0.3 + (i + 1) * lineH))
}

/** Index of the word being spoken at `progress` (0..1) of a cue, weighting each word by its length (a fair stand-in for speech timing). */
export function activeWordIndex(words: string[], progress: number) {
  const weights = words.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length))
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < words.length; i++) { acc += weights[i]; if (progress * total < acc) return i }
  return Math.max(0, words.length - 1)
}

/** Which word is being spoken at `progress` and how far into it (0..1), weighting words by length. */
export function wordSpan(words: string[], progress: number) {
  const weights = words.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const at = Math.min(Math.max(progress, 0), 0.9999) * total
  let acc = 0
  for (let i = 0; i < words.length; i++) {
    if (at < acc + weights[i]) return { index: i, local: (at - acc) / weights[i] }
    acc += weights[i]
  }
  return { index: Math.max(0, words.length - 1), local: 1 }
}

/** The colour that marks the spoken word in the viral look. */
export const VIRAL_ACCENT = '#FFE14D'

/**
 * Reel/TikTok look: a few huge uppercase words, thick black outline and shadow, the spoken word in a bright colour and
 * «popping» (it grows and settles) the moment it starts.
 */
function drawViralCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, progress: number, position: CaptionPosition = 'bottom') {
  const portrait = w < h
  const size = Math.round(Math.min(w, h) * (portrait ? 0.125 : 0.085))
  const words = text.toUpperCase().replace(/[.,;:!?¡¿"«»]/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return
  const { index: active, local } = wordSpan(words, progress)
  ctx.save()
  ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const maxW = w * 0.9
  const lines = wrap(ctx, words.join(' '), maxW)
  const lineH = size * 1.08
  const centerY = h * (position === 'top' ? 0.22 : position === 'center' ? 0.5 : portrait ? 0.64 : 0.8)
  const top = centerY - ((lines.length - 1) * lineH) / 2
  ctx.lineJoin = 'round'; ctx.miterLimit = 2
  ctx.lineWidth = Math.max(6, size * 0.2); ctx.strokeStyle = '#000'
  let index = 0
  lines.forEach((line, li) => {
    const parts = line.split(' ')
    const space = ctx.measureText(' ').width
    const widths = parts.map(p => ctx.measureText(p).width)
    let x = (w - (widths.reduce((a, b) => a + b, 0) + space * (parts.length - 1))) / 2
    const y = top + li * lineH
    parts.forEach((word, k) => {
      const isActive = index === active
      // Pop: starts 22% bigger and eases to normal over the first third of the word.
      const pop = isActive ? 1 + 0.22 * Math.pow(Math.max(0, 1 - local * 3), 2) : 1
      ctx.save()
      ctx.translate(x + widths[k] / 2, y); ctx.scale(pop, pop); ctx.translate(-widths[k] / 2, 0)
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = size * 0.18; ctx.shadowOffsetY = size * 0.07
      ctx.strokeText(word, 0, 0)
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = isActive ? VIRAL_ACCENT : '#fff'
      ctx.fillText(word, 0, 0)
      ctx.restore()
      x += widths[k] + space
      index++
    })
  })
  ctx.restore()
}

/** Shorts-style captions: big, uppercase, outlined; with `progress` the spoken word is highlighted. */
function drawBoldCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, progress: number | null, position: CaptionPosition = 'bottom') {
  const size = Math.round(Math.min(w, h) * (w < h ? 0.075 : 0.06))
  ctx.save()
  ctx.font = `900 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  const active = progress === null ? -1 : activeWordIndex(words, progress)
  const lines = wrap(ctx, words.join(' '), w * 0.86)
  const lineH = size * 1.2
  const centerY = h * (position === 'top' ? (w < h ? 0.2 : 0.16) : position === 'center' ? 0.5 : w < h ? 0.68 : 0.8)
  const top = centerY - ((lines.length - 1) * lineH) / 2
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  let index = 0
  lines.forEach((line, li) => {
    const lw = line.split(' ')
    let x = (w - ctx.measureText(line).width) / 2
    const y = top + li * lineH
    for (const word of lw) {
      ctx.strokeText(word, x, y)
      ctx.fillStyle = index === active ? '#ffd23f' : '#fff'
      ctx.fillText(word, x, y)
      x += ctx.measureText(`${word} `).width
      index++
    }
  })
  ctx.restore()
}

/** Font size of a text in px for a frame (the same formula everywhere, also for the viewer's hit boxes). */
export const textSize = (t: Pick<TextOverlay, 'sizePct'>, w: number, h: number) => Math.round(Math.min(w, h) * (t.sizePct / 100) * 1.6)

/** Lines and block size of a text, for drawing and for hit-testing it on the viewer. */
export function textLayout(ctx: CanvasRenderingContext2D, t: TextOverlay, w: number, h: number) {
  const size = textSize(t, w, h)
  ctx.font = `${t.bold === false ? 500 : 800} ${size}px ${TEXT_FONTS[t.font ?? 'sans'].css}`
  const lines = wrap(ctx, t.content, w * 0.86)
  const lineH = size * 1.15
  const blockH = lines.length * lineH
  const blockW = Math.max(...lines.map(l => ctx.measureText(l).width), 1)
  const top = t.x !== undefined && t.y !== undefined ? t.y * h - blockH / 2 : t.position === 'top' ? h * 0.1 : t.position === 'center' ? (h - blockH) / 2 : h * 0.72 - blockH
  const cx = t.x !== undefined && t.y !== undefined ? t.x * w : w / 2
  return { size, lines, lineH, blockH, blockW, top, cx }
}

const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }

export function drawText(ctx: CanvasRenderingContext2D, t: TextOverlay, w: number, h: number, f: TextFrame = { alpha: 1, scale: 1, offsetY: 0, visibleChars: null }) {
  if (f.alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = f.alpha
  const L = textLayout(ctx, t, w, h)
  const { size, lines, lineH, blockH, cx } = L
  const top = L.top + f.offsetY * h
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (f.scale !== 1) { const cy = top + blockH / 2; ctx.translate(cx, cy); ctx.scale(f.scale, f.scale); ctx.translate(-cx, -cy) }
  if (t.background) {
    const pad = size * 0.3
    ctx.fillStyle = rgba(t.background, t.backgroundOpacity ?? 0.6)
    ctx.fillRect(cx - L.blockW / 2 - pad, top - pad * 0.5, L.blockW + pad * 2, blockH + pad)
  }
  const ow = t.outlineWidth ?? 10
  ctx.lineJoin = 'round'
  ctx.lineWidth = ow > 0 ? Math.max(t.outlineWidth === undefined ? 3 : 1, size * ow / 100) : 0
  ctx.strokeStyle = t.outline ? t.outline : 'rgba(0,0,0,0.85)'
  ctx.fillStyle = t.color ?? '#fff'
  if (t.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetX = size * 0.06; ctx.shadowOffsetY = size * 0.08 }
  let budget = f.visibleChars ?? Infinity
  lines.forEach((l, i) => {
    if (budget <= 0) return
    const shown = budget >= l.length ? l : l.slice(0, budget)
    budget -= l.length + 1
    const y = top + i * lineH + lineH / 2
    // Typed text keeps its final position: measure the full line and draw the visible part from its left edge.
    if (shown !== l) { const x = cx - ctx.measureText(l).width / 2; ctx.textAlign = 'left'; if (ow > 0) ctx.strokeText(shown, x, y); ctx.fillText(shown, x, y); ctx.textAlign = 'center' }
    else { if (ow > 0) ctx.strokeText(l, cx, y); ctx.fillText(l, cx, y) }
  })
  ctx.restore()
}
