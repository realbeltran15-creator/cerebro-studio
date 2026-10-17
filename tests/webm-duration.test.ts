import { describe, expect, it } from 'vitest'
import { addWebmDuration, ensureWebmDuration } from '@/lib/editor/webm-duration'

const el = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body]
const unknownSize = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
/** The layout Chromium's MediaRecorder writes: EBML header, Segment of unknown size, Info (no Duration), Tracks, an unknown-size Cluster. */
function liveWebm(extra: number[] = [], timecodeScale = [0x0f, 0x42, 0x40]) {
  const info = el([0x15, 0x49, 0xa9, 0x66], [...el([0x2a, 0xd7, 0xb1], timecodeScale), ...el([0x4d, 0x80], [0x43, 0x68, 0x72, 0x6f, 0x6d, 0x65]), ...el([0x57, 0x41], [0x43, 0x68, 0x72, 0x6f, 0x6d, 0x65])])
  const tracks = el([0x16, 0x54, 0xae, 0x6b], [0xae, 0x83, 0xd7, 0x81, 0x01])
  const cluster = [0x1f, 0x43, 0xb6, 0x75, ...unknownSize, 0xe7, 0x81, 0x00, 0xa3, 0x84, 0x81, 0x00, 0x80, 0x00]
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])
  return new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, ...unknownSize, ...extra, ...info, ...tracks, ...cluster])
}
const findDuration = (b: Uint8Array) => { for (let i = 0; i + 11 <= b.length; i++) if (b[i] === 0x44 && b[i + 1] === 0x89 && b[i + 2] === 0x88) return new DataView(b.buffer, b.byteOffset + i + 3, 8).getFloat64(0, false); return null }

describe('addWebmDuration', () => {
  it('adds the missing Duration (in the file\'s timecode units) and grows only the Info block', () => {
    const src = liveWebm()
    const out = addWebmDuration(src, 5000)!
    expect(out.length).toBe(src.length + 11)
    expect(findDuration(out)).toBe(5000) // 1 ms timecodes
    // everything after the Info block is byte-identical
    expect(Array.from(out.subarray(out.length - 20))).toEqual(Array.from(src.subarray(src.length - 20)))
  })
  it('respects a different timecode scale', () => {
    const out = addWebmDuration(liveWebm([], [0x0f, 0x42, 0x40]), 2500)!
    expect(findDuration(out)).toBe(2500)
    const micro = addWebmDuration(liveWebm([], [0x03, 0xe8]), 2500)! // 1000 ns per tick
    expect(findDuration(micro)).toBe(2_500_000)
  })
  it('leaves a file that already has a duration alone (idempotent)', () => {
    const once = addWebmDuration(liveWebm(), 5000)!
    expect(addWebmDuration(once, 5000)).toBeNull()
  })
  it('refuses layouts it cannot patch safely and bad input', () => {
    expect(addWebmDuration(liveWebm([0x11, 0x4d, 0x9b, 0x74, 0x80]), 5000)).toBeNull() // SeekHead holds byte positions
    expect(addWebmDuration(new Uint8Array([1, 2, 3, 4]), 5000)).toBeNull()
    expect(addWebmDuration(liveWebm(), 0)).toBeNull()
    expect(addWebmDuration(liveWebm(), Number.NaN)).toBeNull()
  })
})

describe('ensureWebmDuration', () => {
  it('patches WebM blobs and passes everything else through', async () => {
    const patched = await ensureWebmDuration(new Blob([liveWebm() as BlobPart], { type: 'video/webm' }), 4000)
    expect(patched.size).toBe(liveWebm().length + 11)
    const mp4 = new Blob([new Uint8Array(10)], { type: 'video/mp4' })
    expect(await ensureWebmDuration(mp4, 4000)).toBe(mp4)
    const junk = new Blob([new Uint8Array(10)], { type: 'video/webm' })
    expect(await ensureWebmDuration(junk, 4000)).toBe(junk)
  })
})
