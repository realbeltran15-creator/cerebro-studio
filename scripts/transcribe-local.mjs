#!/usr/bin/env node
// Local, offline transcription: video/audio -> 16 kHz mono WAV (ffmpeg) -> whisper.cpp -> <name>.auto.srt
// Nothing is sent anywhere and the spoken content is never printed. Disabled (exit 2) unless the engine and a model exist.
//   CEREBRO_WHISPER_BIN=/path/whisper-cli CEREBRO_WHISPER_MODEL=/path/ggml-base-q5_1.bin node scripts/transcribe-local.mjs input.mp4 [es|en|de|auto]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const [input, lang = 'auto'] = process.argv.slice(2)
const bin = process.env.CEREBRO_WHISPER_BIN, model = process.env.CEREBRO_WHISPER_MODEL
const fail = (code, msg) => { console.error(msg); process.exit(code) }
if (!input) fail(1, 'Uso: transcribe-local.mjs <vídeo|audio> [es|en|de|auto]')
if (!/^(auto|[a-z]{2})$/.test(lang)) fail(1, 'Idioma no válido.')
if (!bin || !model || !existsSync(bin) || !existsSync(model)) fail(2, 'Transcripción automática DESACTIVADA: falta el motor local (CEREBRO_WHISPER_BIN) o el modelo (CEREBRO_WHISPER_MODEL). Los subtítulos manuales siguen funcionando.')
if (!existsSync(input) || !statSync(input).isFile()) fail(1, 'No existe el archivo de entrada.')

const tmp = mkdtempSync(path.join(tmpdir(), 'cerebro-asr-'))
try {
  const wav = path.join(tmp, 'audio.wav')
  const ff = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', wav], { encoding: 'utf8' })
  if (ff.status !== 0) fail(3, 'No se pudo extraer el audio (¿tiene pista de audio?).')
  const out = input.replace(/\.[^.\\/]+$/, '') + '.auto'
  const t0 = Date.now()
  const w = spawnSync(bin, ['-m', model, '-f', wav, '-l', lang, '-osrt', '-of', out, '-np'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] })
  if (w.status !== 0 || !existsSync(out + '.srt')) fail(4, 'El motor local no pudo transcribir.')
  console.log(`OK ${out}.srt (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
} finally { rmSync(tmp, { recursive: true, force: true }) }
