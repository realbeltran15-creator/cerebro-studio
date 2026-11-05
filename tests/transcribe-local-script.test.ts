import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isAutoSubtitleFile, parseSubtitles } from '@/lib/editor/subtitles'

const run = (args: string[], env: Record<string, string> = {}) => spawnSync('node', ['scripts/transcribe-local.mjs', ...args], { encoding: 'utf8', env: { ...process.env, CEREBRO_WHISPER_BIN: '', CEREBRO_WHISPER_MODEL: '', ...env } })
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

describe('transcribe-local.mjs', () => {
  it('queda desactivada (código 2) sin motor ni modelo', () => {
    const r = run(['x.wav'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/DESACTIVADA/)
  })
  it.skipIf(!hasFfmpeg)('con un motor SIMULADO genera un .auto.srt importable (no mide la calidad de ningún modelo real)', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'asr-test-'))
    const wav = path.join(d, 'voz.wav')
    expect(spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', wav]).status).toBe(0)
    const bin = path.join(d, 'fake-whisper.sh'), model = path.join(d, 'm.bin'); writeFileSync(model, 'x')
    // fake engine: honours -of <base> and writes <base>.srt
    writeFileSync(bin, '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-of" ] && OF="$2"; shift; done\nprintf "1\\n00:00:00,000 --> 00:00:01,500\\nTexto simulado\\n\\n" > "$OF.srt"\n'); chmodSync(bin, 0o755)
    const r = run([wav, 'es'], { CEREBRO_WHISPER_BIN: bin, CEREBRO_WHISPER_MODEL: model })
    expect(r.status).toBe(0)
    const out = path.join(d, 'voz.auto.srt')
    expect(existsSync(out)).toBe(true)
    expect(isAutoSubtitleFile(out)).toBe(true)
    expect(parseSubtitles(readFileSync(out, 'utf8')).cues[0].endMs).toBe(1500)
    expect(r.stdout).not.toMatch(/Texto simulado/)
  })
  it('rechaza idiomas con caracteres raros', () => {
    expect(run(['x.wav', '../etc'], { CEREBRO_WHISPER_BIN: '/bin/true', CEREBRO_WHISPER_MODEL: '/bin/true' }).status).toBe(1)
  })
})
