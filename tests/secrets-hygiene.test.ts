// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue
    const p = path.join(dir, n); const s = statSync(p)
    if (s.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]
const rel = (p: string) => path.relative(root, p)

describe('higiene de secretos (análisis estático del código)', () => {
  it('ningún componente de cliente lee variables de entorno privadas', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!/^\s*['"]use client['"]/.test(src)) continue
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!m[1].startsWith('NEXT_PUBLIC_') && m[1] !== 'NODE_ENV') bad.push(`${rel(f)}: ${m[1]}`)
    }
    expect(bad).toEqual([])
  })
  it('ningún log escribe tokens, secretos o claves', () => {
    const bad: string[] = []
    const re = /console\.(log|error|warn|info|debug)\(([^;]*)\)/g
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(re)) {
        const args = m[2]
        // Se permiten mensajes/identificadores; se rechazan variables cuyo nombre sea un secreto pasado tal cual.
        if (/(^|[\s,{(:])(access_?token|refresh_?token|accessToken|refreshToken|clientSecret|client_secret|apiKey|api_key|secret|password|authorization)\s*(,|\}|\)|$)/i.test(args)) bad.push(`${rel(f)}: ${m[0].slice(0, 100)}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('ningún componente de cliente importa módulos solo de servidor (admin, cifrado, OAuth, almacenamiento de servidor)', () => {
    const bad: string[] = []
    const serverOnly = /^(?!import\s+type).*from\s+['"](@\/lib\/supabase\/(admin|server)|@\/lib\/storage\/server|@\/lib\/crypto[^'"]*|@\/lib\/oauth\/[^'"]*|@\/lib\/publication\/youtube)['"]/
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!/^\s*['"]use client['"]/.test(src)) continue
      for (const line of src.split('\n')) { const m = line.match(serverOnly); if (m) bad.push(`${rel(f)}: ${m[1]}`) }
    }
    expect(bad).toEqual([])
  })
})
