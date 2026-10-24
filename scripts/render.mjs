// Bundles and runs the offline renderer (scripts/render-cli.entry.ts). See that file for usage.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const outfile = path.join(root, 'node_modules/.cache/cerebro-render/render-cli.mjs')
mkdirSync(path.dirname(outfile), { recursive: true })
await build({ entryPoints: [path.join(root, 'scripts/render-cli.entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile, external: ['@napi-rs/canvas'], logLevel: 'error', banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } })
process.exit(spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1)
