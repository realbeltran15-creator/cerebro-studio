import { transcodeToCompatibleMp4, TranscodeError } from '@/lib/editor/transcode'
import { mp4Codecs, videoCodecOf } from '@/lib/editor/container'

const w = window as unknown as Record<string, unknown>

/** Records ~2 s of canvas video plus a sine tone in a non-H.264 format (VP9 + Opus), exactly what Firefox and some Chromium builds produce. */
async function recordSource() {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
  const ctx2d = canvas.getContext('2d')!
  const ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start()
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()])
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t))!
  const rec = new MediaRecorder(stream, { mimeType }); const chunks: Blob[] = []
  rec.ondataavailable = e => chunks.push(e.data); const stopped = new Promise(r => { rec.onstop = r })
  rec.start()
  for (let i = 0; i < 40; i++) { ctx2d.fillStyle = `hsl(${i * 9},80%,50%)`; ctx2d.fillRect(0, 0, 320, 180); await new Promise(r => setTimeout(r, 50)) }
  rec.stop(); await stopped; osc.stop(); await ac.close()
  return new Blob(chunks, { type: mimeType.split(';')[0] })
}

w.runTranscode = async (baseUrl: string, vendorBase: string) => {
  const src = await recordSource()
  const progress: number[] = []
  const out = await transcodeToCompatibleMp4(src, { config: { baseUrl, vendorBase }, onProgress: p => progress.push(p) })
  const bytes = new Uint8Array(await out.blob.arrayBuffer())
  return { srcType: src.type, srcSize: src.size, outSize: out.blob.size, outType: out.blob.type, mime: out.mimeType, mimeCodec: videoCodecOf(out.mimeType), codecs: mp4Codecs(bytes), head: String.fromCharCode(...bytes.slice(4, 8)), progressSeen: progress.length > 0 && progress.every(p => p >= 0 && p <= 1) }
}

w.runTranscodeBadHost = async () => {
  const src = new Blob([new Uint8Array(2000)], { type: 'video/webm' })
  try { await transcodeToCompatibleMp4(src, { config: { baseUrl: 'http://127.0.0.1:1/none' } }); return { error: null } }
  catch (e) { return { error: e instanceof TranscodeError ? e.message : `other:${String(e)}` } }
}
w.runTranscodeEmpty = async () => {
  try { await transcodeToCompatibleMp4(new Blob([]), { config: { baseUrl: 'https://example.invalid' } }); return { error: null } }
  catch (e) { return { error: e instanceof TranscodeError ? e.message : `other:${String(e)}` } }
}
