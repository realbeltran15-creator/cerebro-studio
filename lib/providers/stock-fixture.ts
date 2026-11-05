import { deflateSync } from 'node:zlib'

/**
 * Synthetic stock results for LOCAL tests only. Enabled with CEREBRO_STOCK_FIXTURE=1 and never when the private beta is on.
 * Items are plainly labelled as test data (never presented as Pexels results) and their files are served by this same app,
 * so no external host is contacted and nothing third-party is downloaded.
 */
export const stockFixtureOn = (env: Record<string, string | undefined> = process.env) => env.CEREBRO_STOCK_FIXTURE === '1' && env.NEXT_PUBLIC_CEREBRO_BETA !== 'private'

export const FIXTURE_COLORS: Record<string, [number, number, number]> = { 'prueba-1': [200, 60, 60], 'prueba-2': [60, 160, 90], 'prueba-3': [70, 90, 200] }

const crcTable = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }

/** A solid-colour 640×360 PNG. */
export function fixturePng(id: string) {
  const [r, g, b] = FIXTURE_COLORS[id] ?? [128, 128, 128]
  const w = 640, h = 360
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); raw[o] = 0; for (let x = 0; x < w; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export const FIXTURE_NOTICE = 'DATOS DE PRUEBA: no son resultados de Pexels.'
