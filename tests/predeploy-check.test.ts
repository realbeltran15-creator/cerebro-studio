import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const run = (args: string[]) => spawnSync('node', ['scripts/predeploy-check.mjs', ...args], { encoding: 'utf8' })
const envFile = (lines: string[]) => { const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'pd-')), 'plan.env'); writeFileSync(f, lines.join('\n')); return f }
const good = ['NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local', 'NEXT_PUBLIC_CEREBRO_BETA=private']

describe('comprobación previa al despliegue (falla cerrado)', () => {
  it('sin fichero de variables se rechaza', () => { const r = run(['--vercel-config', 'vercel.beta.json']); expect(r.status).toBe(1); expect(r.stdout).toContain('falta --env') })
  it('un plan correcto con la configuración sin crons es apto', () => { const r = run(['--env', envFile(good), '--vercel-config', 'vercel.beta.json']); expect(r.stdout).toContain('APTO'); expect(r.status).toBe(0) })
  it('rechaza el proyecto de Production, claves de pago y privilegiadas, sin imprimir sus valores', () => {
    const r = run(['--env', envFile(['NEXT_PUBLIC_SUPABASE_URL=https://psbvqdaksrfrkxbewrll.supabase.co', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x', 'NEXT_PUBLIC_CEREBRO_BETA=private', 'FAL_KEY=valor-secreto-123', 'SUPABASE_SERVICE_ROLE_KEY=otro-secreto-456']), '--vercel-config', 'vercel.beta.json'])
    expect(r.status).toBe(1); expect(r.stdout).toContain('Production'); expect(r.stdout + r.stderr).not.toMatch(/valor-secreto-123|otro-secreto-456/)
  })
  it('rechaza una beta sin NEXT_PUBLIC_CEREBRO_BETA=private', () => { const r = run(['--env', envFile(good.slice(0, 2)), '--vercel-config', 'vercel.beta.json']); expect(r.status).toBe(1); expect(r.stdout).toContain('NEXT_PUBLIC_CEREBRO_BETA') })
  it('rechaza una configuración de Vercel con crons (vercel.json de Production)', () => { const r = run(['--env', envFile(good), '--vercel-config', 'vercel.json']); expect(r.status).toBe(1); expect(r.stdout).toContain('cron') })
  it('un fichero de variables inexistente se rechaza', () => { expect(run(['--env', '/no/existe.env', '--vercel-config', 'vercel.beta.json']).status).toBe(1) })
  it('el repositorio no contiene ficheros .env versionados', () => { expect(execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(f => /(^|\/)\.env(\.|$)/.test(f) && !/example|sample/.test(f))).toEqual([]) })
})
