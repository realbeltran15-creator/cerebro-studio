/** Genera vídeos de prueba GRATIS y locales con ffmpeg (patrón de test + tono). Sin material protegido ni descargas. */
import { execFile } from 'node:child_process'
import { open, readFile, truncate, writeFile } from 'node:fs/promises'

export type TestVideoOpts = {
  durationSec?: number; width?: number; height?: number
  audio?: 'tone' | 'silent' | 'none'
  /** Tramo en negro (segundos). */
  black?: { from: number; to: number }
  /** Varía el patrón para que dos vídeos no sean idénticos. */
  seed?: number
}

export function makeTestVideo(out: string, o: TestVideoOpts = {}): Promise<void> {
  const d = o.durationSec ?? 4, w = o.width ?? 320, h = o.height ?? 180
  const vf = [o.black ? `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,${o.black.from},${o.black.to})'` : '', 'format=yuv420p'].filter(Boolean).join(',')
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=24:duration=${d}${o.seed ? `,hue=h=${o.seed * 37}` : ''}`]
  const a = o.audio ?? 'tone'
  if (a === 'tone') args.push('-f', 'lavfi', '-i', `sine=frequency=${440 + (o.seed ?? 0) * 20}:duration=${d}`)
  if (a === 'silent') args.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono:d=${d}`)
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart')
  if (a !== 'none') args.push('-c:a', 'aac', '-shortest')
  args.push(out)
  return new Promise((res, rej) => execFile('ffmpeg', args, { timeout: 60_000 }, e => (e ? rej(e) : res())))
}

/** Corrompe bytes del interior del archivo (el contenedor sigue siendo legible pero la decodificación falla). */
export async function corruptMiddle(file: string, bytes = 400): Promise<void> {
  const buf = await readFile(file)
  const start = Math.floor(buf.length / 2)
  for (let i = 0; i < bytes && start + i < buf.length; i++) buf[start + i] = (buf[start + i] ^ 0xff) & 0xff
  await writeFile(file, buf)
}

/** Trunca el archivo: se pierde el contenedor completo. */
export async function truncateFile(file: string, keepRatio = 0.3): Promise<void> {
  const fh = await open(file, 'r'); const { size } = await fh.stat(); await fh.close()
  await truncate(file, Math.floor(size * keepRatio))
}
