import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RenderTicket } from './ticket'
import type { AssetFile } from './engine'

/**
 * Downloads the materials of a render ticket into a folder. Resumable: a half-downloaded file continues where it stopped (HTTP Range) and a
 * finished one (`<id>.ok` marker) is not downloaded again, so running the renderer again after a cut costs nothing.
 */
export async function downloadTicketAssets(ticket: RenderTicket, dir: string, o: { onProgress?: (e: { id: string; done: number; total: number; index: number; count: number }) => void; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<Record<string, AssetFile>> {
  await fs.mkdir(dir, { recursive: true })
  const get = o.fetchImpl ?? fetch
  const ids = Object.keys(ticket.assets)
  const out: Record<string, AssetFile> = {}
  let index = 0
  for (const id of ids) {
    index++
    const a = ticket.assets[id]
    const safe = id.replace(/[^\w.-]/g, '_')
    const file = path.join(dir, `${safe}.bin`), part = `${file}.part`, ok = `${file}.ok`
    out[id] = { path: file, kind: a.kind }
    if (existsSync(ok) && existsSync(file)) continue
    for (let attempt = 0; ; attempt++) {
      try {
        let have = existsSync(part) ? (await fs.stat(part)).size : 0
        const r = await get(a.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: o.signal })
        if (r.status === 416) { await fs.rename(part, file); break }  // the part is already the whole file
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
        if (r.status === 200 && have) have = 0   // the server ignored the range: start over
        const total = have + Number(r.headers.get('content-length') ?? 0)
        let done = have
        const body = Readable.fromWeb(r.body as never)
        body.on('data', (c: Buffer) => { done += c.length; o.onProgress?.({ id, done, total, index, count: ids.length }) })
        await pipeline(body, createWriteStream(part, { flags: have ? 'a' : 'w' }))
        await fs.rename(part, file)
        break
      } catch (e) {
        if (o.signal?.aborted) throw e
        if (attempt >= 4) throw new Error(`No se pudo descargar el material ${id}: ${e instanceof Error ? e.message : e}`)
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
    await fs.writeFile(ok, '')
  }
  return out
}
