import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyKind, CONTENT_ID_NOTE, importProblems, importProvenance, licenseFor } from '@/lib/providers/topmediai-import'
import { checkCloudflare, checkGemini, checkTopMediai, runCheck } from '@/lib/providers/check'
import { summarizeUsage, type UsageAsset } from '@/lib/providers/usage'

describe('TopMediai import: licence follows the plan you confirm', () => {
  it('a confirmed paid plan is stored as licensed with the Content ID caveat and the certificate note', () => {
    const l = licenseFor('paid', true, 'PDF en Drive/Licencias/2026-10')
    expect(l.status).toBe('licensed')
    expect(l.notes).toMatch(/PDF en Drive/)
    expect(l.notes).toContain(CONTENT_ID_NOTE)
  })
  it('anything not confirmed as paid is stored as restricted (personal use), never as licensed', () => {
    expect(licenseFor('paid', false).status).toBe('restricted')
    expect(licenseFor('free', true).status).toBe('restricted')
    expect(licenseFor('free', true).notes).toMatch(/uso personal/)
  })
  it('guesses the kind from the name and the length, and keeps music as the default', () => {
    expect(classifyKind({ name: 'My-TTS-voice.mp3', durationSeconds: 30 })).toBe('voice')
    expect(classifyKind({ name: 'whoosh_impact.wav', durationSeconds: 3 })).toBe('sfx')
    expect(classifyKind({ name: 'song_final.mp3', durationSeconds: 5 })).toBe('music')
    expect(classifyKind({ name: 'abc123.mp3', durationSeconds: 4 })).toBe('sfx')
    expect(classifyKind({ name: 'abc123.mp3', durationSeconds: 150 })).toBe('music')
    expect(classifyKind({ name: 'abc123.mp3', durationSeconds: null })).toBe('music')
  })
  it('records provenance that the usage report understands and flags the import as such', () => {
    const { license, extra } = importProvenance({ title: 't', kind: 'music', plan: 'paid', confirmedPaid: true, prompt: 'lofi rain', model: 'V4.5', certificate: 'cert.pdf', originalFilename: 'a.mp3' })
    expect(license.status).toBe('licensed')
    expect(extra).toMatchObject({ provider: 'topmediai', importedFrom: 'topmediai-web', originalPrompt: 'lofi rain', generationModel: 'V4.5', planAtGeneration: 'paid', licenseCertificate: 'cert.pdf' })
    expect(extra.contentIdWarning).toBe(CONTENT_ID_NOTE)
    const asset: UsageAsset = { id: '1', asset_type: 'music', project_id: 'p', source_provider: 'topmediai', license_status: license.status, provenance: extra, created_at: '2026-10-10T10:00:00Z' }
    const u = summarizeUsage([asset])
    expect(u.generations).toBe(1)
    expect(u.rows[0].provider).toBe('TopMediai (importado)')
    expect(u.estimatedUsd).toBe(0)
  })
  it('does not put a content-ID warning on voices or effects, and truncates long prompts', () => {
    const { extra } = importProvenance({ title: 't', kind: 'voice', plan: 'free', confirmedPaid: false, prompt: 'x'.repeat(5000), originalFilename: 'v.mp3' })
    expect(extra.contentIdWarning).toBeNull()
    expect(String(extra.originalPrompt).length).toBe(1000)
    expect(extra.planAtGeneration).toBe('unconfirmed_or_free')
  })
  it('rejects non-audio files and oversized batches with a helpful message', () => {
    expect(importProblems([])).toEqual(['Elige al menos un archivo.'])
    expect(importProblems([{ name: 'a.zip', size: 1, type: 'application/zip' }])[0]).toMatch(/MP3 o WAV/)
    expect(importProblems(Array.from({ length: 21 }, (_, i) => ({ name: `${i}.mp3`, size: 1, type: 'audio/mpeg' }))).join()).toMatch(/20 archivos/)
    expect(importProblems([{ name: 'a.mp3', size: 1, type: 'audio/mpeg' }])).toEqual([])
  })
})

describe('zero-cost connection checks', () => {
  let calls: Array<{ url: string; init?: RequestInit }> = []
  const mock = (fn: (url: string) => Response) => { calls = []; vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), init }); return fn(String(url)) })) }
  beforeEach(() => { for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY', 'TOPMEDIAI_API_KEY']) delete process.env[k] })
  afterEach(() => vi.unstubAllGlobals())

  it('say what is missing without calling anything when a key is absent', async () => {
    mock(() => Response.json({}))
    for (const p of ['cloudflare', 'gemini', 'topmediai'] as const) expect((await runCheck(p)).state).toBe('not_configured')
    expect(calls).toHaveLength(0)
  })
  it('Cloudflare: verifies the token (read-only) and never calls the AI endpoint', async () => {
    Object.assign(process.env, { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' })
    mock(() => Response.json({ success: true, result: { status: 'active' } }))
    const r = await checkCloudflare()
    expect(r.state).toBe('ok')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/user/tokens/verify')
    expect(calls[0].url).not.toMatch(/\/ai\/run/)
    mock(() => Response.json({}, { status: 401 }))
    expect((await checkCloudflare()).state).toBe('invalid_key')
  })
  it('Gemini: only lists models and warns that listing is not a free allowance', async () => {
    process.env.GEMINI_API_KEY = 'k'
    mock(() => Response.json({ models: [{ name: 'models/gemini-3.1-flash-image' }, { name: 'models/veo-3.1-generate-preview' }, { name: 'models/gemini-3.8-flash-tts' }, { name: 'models/lyria-3.5' }] }))
    const r = await checkGemini()
    expect(r.state).toBe('ok')
    expect(r.details).toMatchObject({ models: 4, imageModels: 1, videoModels: 1, musicModels: 1, ttsModels: 1 })
    expect(r.message).toMatch(/exigen facturación/)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200')
    expect(calls[0].url).not.toMatch(/generateContent|predict/)
    mock(() => Response.json({}, { status: 403 }))
    expect((await checkGemini()).state).toBe('invalid_key')
  })
  it('TopMediai: reads the key quota and returns no secrets', async () => {
    process.env.TOPMEDIAI_API_KEY = 'secret-key'
    mock(() => Response.json({ x_api_key: 'secret-key', email: 'a@b.c', key_status: 'active', key_words_counts: 5000 }))
    const r = await checkTopMediai()
    expect(r.state).toBe('ok')
    expect(calls[0].url).toBe('https://api.topmediai.com/v1/get_api_key_info')
    expect(JSON.stringify(r)).not.toMatch(/secret-key|a@b\.c/)
    expect(r.details).toEqual({ key_status: 'active', key_words_counts: 5000 })
    mock(() => Response.json({}, { status: 401 }))
    expect((await checkTopMediai()).state).toBe('invalid_key')
  })
})
