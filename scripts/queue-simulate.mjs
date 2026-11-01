/** Runner de simulación de la cola (Fase 4B.2): npm run queue:simulate -- --help. Solo local, dry_run obligatorio. */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const result = await build({ entryPoints: [path.join(root, 'scripts/queue-simulate.entry.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20', alias: { '@': root },
  external: ['pg', 'pg-native'], logLevel: 'error', banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } })
const dir = path.join(root, 'node_modules/.cache/queue-simulate')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'run.mjs')
writeFileSync(file, result.outputFiles[0].text)
await import(pathToFileURL(file).href)
