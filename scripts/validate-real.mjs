/**
 * The three real validations (≈ 714 quota units, 7 searches in total) with the REAL YouTube Data API, using the same code as the app:
 *   YOUTUBE_API_KEY=… npm run research:validate            real run (needs the key in the environment; it is never printed)
 *   npm run research:validate -- --selftest                runs the script on SIMULATED data to check it works; its output is NOT a validation
 * Cases: «ETF Sparplan erklärt» (DE, de) · «first time buyer» (GB, en) · «first time buyer» (US, en), then one growth measurement and a second
 * attempt that must NOT call YouTube. Writes research-output/validation-<date>.md and .json.
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const result = await build({ entryPoints: [path.join(root, 'scripts/validate-real.entry.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20', alias: { '@': root }, logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } })
const dir = mkdtempSync(path.join(tmpdir(), 'validate-real-'))
const file = path.join(dir, 'run.mjs')
writeFileSync(file, result.outputFiles[0].text)
await import(pathToFileURL(file).href)
