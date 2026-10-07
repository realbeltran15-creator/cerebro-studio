import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const vendored = path.join(process.cwd(), 'public/vendor/ffmpeg')
const installed = path.join(process.cwd(), 'node_modules/@ffmpeg/ffmpeg/dist/esm')
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('vendored ffmpeg.wasm wrapper (MIT) stays in sync and the GPL core is never committed', () => {
  it('is byte-identical to the installed @ffmpeg/ffmpeg release', () => {
    const files = readdirSync(vendored).filter(n => n.endsWith('.js'))
    expect(files.sort()).toEqual(['classes.js', 'const.js', 'errors.js', 'index.js', 'types.js', 'utils.js', 'worker.js'])
    for (const f of files) expect(sha(path.join(vendored, f)), f).toBe(sha(path.join(installed, f)))
  })
  it('ships its MIT notice', () => {
    expect(readFileSync(path.join(vendored, 'NOTICE.txt'), 'utf8')).toMatch(/MIT License/)
  })
  it('does not contain the GPL core or any wasm binary', () => {
    for (const dir of [vendored, path.join(process.cwd(), 'public')]) {
      const all = readdirSync(dir, { recursive: true }).map(String)
      expect(all.filter(n => /\.wasm$|ffmpeg-core/.test(n))).toEqual([])
    }
    expect(existsSync(path.join(vendored, 'ffmpeg-core.wasm'))).toBe(false)
  })
})
