/**
 * MediaRecorder writes WebM as a live stream: the header has no Duration, so players cannot show the length or seek,
 * and some editors refuse the file. This adds the missing Duration element to the Info block.
 *
 * It only touches the one layout the browser produces: Segment of unknown size, an Info block without Duration, and no
 * SeekHead or Cues (they would hold byte positions that the insertion shifts). Anything else is returned untouched.
 */
const ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_DURATION = 0x4489, ID_TIMECODE_SCALE = 0x2ad7b1, ID_SEEKHEAD = 0x114d9b74, ID_CUES = 0x1c53bb6b, ID_CLUSTER = 0x1f43b675

type Vint = { value: number; length: number; unknown: boolean }

function readId(b: Uint8Array, o: number): Vint | null {
  if (o >= b.length) return null
  const first = b[o]
  let length = 1
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 4 || o + length > b.length) return null
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + b[o + i]
  return { value, length, unknown: false }
}

function readSize(b: Uint8Array, o: number): Vint | null {
  if (o >= b.length) return null
  const first = b[o]
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 8 || o + length > b.length) return null
  let value = first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i++) { value = value * 256 + b[o + i]; if (b[o + i] !== 0xff) allOnes = false }
  return { value, length, unknown: allOnes }
}

/** The patched bytes, or null when the file already has a duration or its layout is not the one this can patch safely. */
export function addWebmDuration(bytes: Uint8Array, durationMs: number): Uint8Array | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  // EBML header, then the Segment.
  const ebml = readId(bytes, 0)
  if (!ebml || ebml.value !== 0x1a45dfa3) return null
  const ebmlSize = readSize(bytes, ebml.length)
  if (!ebmlSize || ebmlSize.unknown) return null
  const segmentAt = ebml.length + ebmlSize.length + ebmlSize.value
  const seg = readId(bytes, segmentAt)
  if (!seg || seg.value !== ID_SEGMENT) return null
  const segSize = readSize(bytes, segmentAt + seg.length)
  if (!segSize) return null
  const segBody = segmentAt + seg.length + segSize.length
  const segEnd = segSize.unknown ? bytes.length : Math.min(bytes.length, segBody + segSize.value)

  let o = segBody
  while (o < segEnd) {
    const id = readId(bytes, o)
    if (!id) return null
    const size = readSize(bytes, o + id.length)
    if (!size || size.unknown) return null
    if (id.value === ID_SEEKHEAD || id.value === ID_CUES) return null
    if (id.value === ID_CLUSTER) return null // Info must come first
    const body = o + id.length + size.length
    if (id.value === ID_INFO) {
      let timecodeScale = 1_000_000
      for (let p = body; p < body + size.value;) {
        const cid = readId(bytes, p)
        const csz = cid && readSize(bytes, p + cid.length)
        if (!cid || !csz || csz.unknown) return null
        if (cid.value === ID_DURATION) return null
        if (cid.value === ID_TIMECODE_SCALE) { let v = 0; for (let i = 0; i < csz.value; i++) v = v * 256 + bytes[p + cid.length + csz.length + i]; if (v > 0) timecodeScale = v }
        p += cid.length + csz.length + csz.value
      }
      const newSize = size.value + 11 // Duration: 2-byte id + 1-byte size + 8-byte float
      const maxForLength = 2 ** (7 * size.length) - 2
      if (newSize > maxForLength) return null
      const duration = new Uint8Array(11)
      duration[0] = ID_DURATION >> 8; duration[1] = ID_DURATION & 0xff; duration[2] = 0x88
      new DataView(duration.buffer).setFloat64(3, (durationMs * 1_000_000) / timecodeScale, false)
      const out = new Uint8Array(bytes.length + 11)
      out.set(bytes.subarray(0, o + id.length), 0)
      // Re-write the Info size with the same number of bytes.
      for (let i = size.length - 1, v = newSize; i >= 0; i--) { out[o + id.length + i] = v & 0xff; v = Math.floor(v / 256) }
      out[o + id.length] |= 0x80 >> (size.length - 1)
      out.set(bytes.subarray(o + id.length + size.length, body + size.value), o + id.length + size.length)
      out.set(duration, body + size.value)
      out.set(bytes.subarray(body + size.value), body + size.value + 11)
      return out
    }
    o = body + size.value
  }
  return null
}

/** Returns the blob with its duration in the header when it is a WebM that needs it; otherwise the same blob. */
export async function ensureWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!/webm/i.test(blob.type)) return blob
  try {
    const patched = addWebmDuration(new Uint8Array(await blob.arrayBuffer()), durationMs)
    return patched ? new Blob([patched as BlobPart], { type: blob.type }) : blob
  } catch { return blob }
}
