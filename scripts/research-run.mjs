/**
 * Guided research from the command line (same code as the app, real YouTube Data API).
 *   YOUTUBE_API_KEY=… npm run research:run -- --markets US,DE,AU,GB,CA,CH --per 20 [--niches ia,finanzas] [--days 30] [--dry]
 * Resumable (progress in .research/), respects RESEARCH_DAILY_UNIT_CAP, writes research-output/informe-<fecha>.md/.csv. Never prints the key.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const result = await build({ entryPoints: [path.join(root, 'scripts/research-run.entry.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20', alias: { '@': root }, logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } })
const dir = mkdtempSync(path.join(tmpdir(), 'research-run-'))
const file = path.join(dir, 'run.mjs')
writeFileSync(file, result.outputFiles[0].text)
await import(pathToFileURL(file).href)
