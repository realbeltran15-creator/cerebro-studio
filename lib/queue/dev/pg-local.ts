/**
 * SOLO DESARROLLO/TESTS: levanta un PostgreSQL DESECHABLE (socket unix en /tmp, sin red) con stubs de Supabase,
 * aplica la migracion pendiente y lo destruye al terminar. Nunca se conecta a nada externo.
 * Requiere los binarios de postgres (Linux/macOS). Como root usa el usuario `postgres`.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, chownSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Pool } from 'pg'

export const OWNER_A = '00000000-0000-0000-0000-00000000000a'
export const OWNER_B = '00000000-0000-0000-0000-00000000000b'
export const PROJECT_A = '00000000-0000-0000-0000-0000000000a1'
export const PROJECT_B = '00000000-0000-0000-0000-0000000000b1'

const ROOT = process.cwd()   // npm run / vitest siempre arrancan en la raiz del proyecto
export const MIGRATION = path.join(ROOT, 'supabase/pending/20261101120000_job_queue.sql')
export const ROLLBACK = path.join(ROOT, 'supabase/pending/20261101120000_job_queue.rollback.sql')

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
create table public.projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), name text);
grant all on all tables in schema public to service_role;
insert into auth.users values ('${OWNER_A}'), ('${OWNER_B}');
insert into public.projects (id, owner_id, name) values ('${PROJECT_A}', '${OWNER_A}', 'proyecto A'), ('${PROJECT_B}', '${OWNER_B}', 'proyecto B');
`

export function findPgBin(): string | null {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter(d => existsSync(path.join(base, d, 'bin/initdb'))).sort().pop()
  return v ? path.join(base, v, 'bin') : null
}

export const pgAvailable = () => process.platform !== 'win32' && findPgBin() !== null && (process.getuid?.() === 0 ? spawnSync('id', ['postgres']).status === 0 : true)

export type LocalPg = { dir: string; port: number; admin: Pool; connect(role?: string): Pool; stop(): Promise<void> }

export async function startLocalPg(opts: { migrate?: boolean } = {}): Promise<LocalPg> {
  const bin = findPgBin()
  if (!bin) throw new Error('No hay binarios de PostgreSQL locales')
  const asRoot = process.getuid?.() === 0
  const dir = mkdtempSync(path.join(tmpdir(), 'pgsim.'))
  const data = path.join(dir, 'data')
  const port = 54400 + Math.floor(Math.random() * 400)
  const run = (cmd: string, args: string[]) =>
    asRoot ? execFileSync('su', ['postgres', '-s', '/bin/bash', '-c', [cmd, ...args].map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')], { stdio: 'pipe' })
           : execFileSync(cmd, args, { stdio: 'pipe' })
  if (asRoot) chownSync(dir, Number(execFileSync('id', ['-u', 'postgres']).toString()), Number(execFileSync('id', ['-g', 'postgres']).toString()))
  run(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust'])
  run(path.join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start'])
  const mk = (database: string, role?: string) => {
    if (role && !/^[a-z_]+$/.test(role)) throw new Error('rol no valido')
    return new Pool({ host: dir, port, user: 'postgres', database, max: 12, ...(role ? { options: `-c role=${role}` } : {}) })
  }
  const bootstrap = mk('postgres')
  await bootstrap.query('create database t')
  await bootstrap.end()
  const admin = mk('t')
  await admin.query(STUBS)
  if (opts.migrate !== false) await admin.query(readFileSync(MIGRATION, 'utf8'))
  const pools: Pool[] = [admin]
  return {
    dir, port, admin,
    connect: (role = 'service_role') => { const p = mk('t', role); pools.push(p); return p },
    stop: async () => {
      await Promise.all(pools.map(p => p.end().catch(() => {})))
      try { run(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']) } catch { /* ya parado */ }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
