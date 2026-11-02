import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const src = (p: string) => readFileSync(p, 'utf8')

describe('proteccion frente a activaciones accidentales (4B.3)', () => {
  it('vercel.json de la beta: sin cron y solo compila la rama beta-privada (la base 0497f75 tenia el cron)', () => {
    const j = JSON.parse(src('vercel.json'))
    expect(j.crons).toBeUndefined()
    expect(j.ignoreCommand).toMatch(/beta-privada/)
    const base = JSON.parse(execFileSync('git', ['show', '0497f75:vercel.json'], { encoding: 'utf8' }))
    expect(base.crons?.length).toBeGreaterThan(0) // el cron solo existe en la rama original; aqui se retira a proposito
  })
  it('las rutas y el panel de cola no importan ejecutor, simulacion ni proveedores', () => {
    for (const f of [...walk('app/api/queue'), 'app/queue/page.tsx', 'lib/queue/api.ts', 'lib/queue/server.ts']) {
      const s = src(f)
      expect(s, f).not.toMatch(/executor|simulation|runOnce|providers\/|publication|youtube/i)
    }
  })
  it('el panel de cliente no referencia secretos ni la clave de servicio', () => {
    expect(src('app/queue/page.tsx')).not.toMatch(/SERVICE_ROLE|serviceRoleClient|process\.env|CRON_SECRET/)
  })
  it('ninguna ruta de app ejecuta runOnce (no hay worker automatico)', () => {
    for (const f of walk('app').filter(p => /\.(ts|tsx)$/.test(p))) expect(src(f), f).not.toMatch(/runOnce\(/)
  })
  it('las respuestas de error no incluyen mensajes internos de la base', () => {
    expect(src('lib/queue/api.ts')).not.toMatch(/message:\s*e\b|e\.message\s*}/)
  })
})
