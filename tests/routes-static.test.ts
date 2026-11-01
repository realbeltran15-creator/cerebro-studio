// @vitest-environment node
/** Navegación (análisis ESTÁTICO): todo enlace interno literal apunta a una ruta que existe. No sustituye a un recorrido en navegador. */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appDir = path.resolve(__dirname, '..', 'app')
const walk = (d: string, o: string[] = []) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p, o) : o.push(p) } return o }
const all = walk(appDir)
const pages = all.filter(f => /\/page\.tsx$/.test(f)).map(f => '/' + path.relative(appDir, path.dirname(f)).split(path.sep).filter(s => !/^\(.*\)$/.test(s)).join('/')).map(r => r === '/.' || r === '/' ? '/' : r)
const regexes = pages.map(r => new RegExp('^' + r.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '$'))
const exists = (href: string) => regexes.some(r => r.test(href)) || (href.startsWith('/api/') )

describe('rutas internas', () => {
  it('cada href/router.push literal apunta a una página existente', () => {
    const bad: string[] = []
    for (const f of all.filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/(?:href|push|replace)=?\(?\{?["'`](\/[a-zA-Z0-9\-_/\[\]]*)(?:[?#"'`$][^"'`]*)?["'`]/g)) {
        const href = m[1].replace(/\/$/, '') || '/'
        if (!exists(href)) bad.push(`${path.relative(appDir, f)} → ${m[1]}`)
      }
    }
    expect([...new Set(bad)]).toEqual([])
  })
})
