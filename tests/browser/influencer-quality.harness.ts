import { measureImage, measureVideo } from '@/lib/virtual-influencer/measure'
import { avSyncCheck, flickerCheck, resolutionCheck } from '@/lib/virtual-influencer/quality'

async function clip(flicker: boolean, withAudio: boolean, seconds = 2) {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720
  const x = c.getContext('2d')!, stream = c.captureStream(30)
  let ac: AudioContext | null = null
  if (withAudio) { ac = new AudioContext(); const o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach(t => stream.addTrack(t)) }
  const r = new MediaRecorder(stream, { mimeType: withAudio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8' }), parts: Blob[] = []
  r.ondataavailable = e => parts.push(e.data); r.start()
  const t0 = performance.now(); let f = 0
  await new Promise<void>(res => { const tick = () => { f++; x.fillStyle = flicker ? (Math.floor((performance.now() - t0) / 100) % 2 ? '#fff' : '#111') : '#777'; x.fillRect(0, 0, 1280, 720); if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick); else res() }; tick() })
  r.stop(); await new Promise(res => (r.onstop = res)); await ac?.close()
  return URL.createObjectURL(new Blob(parts, { type: 'video/webm' }))
}
;(window as any).runTest = async () => {
  const oc = new OffscreenCanvas(800, 600); oc.getContext('2d')!.fillRect(0, 0, 800, 600)
  const img = await measureImage(URL.createObjectURL(await oc.convertToBlob()))
  const stable = await measureVideo(await clip(false, true))
  const flick = await measureVideo(await clip(true, false))
  return {
    image: { ...img, check: resolutionCheck('image', img.width, img.height).status },
    stable: { w: stable.width, h: stable.height, dur: stable.durationMs, audio: stable.audioDurationMs, res: resolutionCheck('video', stable.width, stable.height).status, av: avSyncCheck(stable.durationMs, stable.audioDurationMs), flicker: flickerCheck(stable.lumas) },
    flickering: { audio: flick.audioDurationMs, av: avSyncCheck(flick.durationMs, flick.audioDurationMs).status, flicker: flickerCheck(flick.lumas) },
  }
}
