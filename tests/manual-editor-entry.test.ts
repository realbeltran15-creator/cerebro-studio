import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { compositionFromAssets, manualEditorHref, parseAssetIds, parseFormat } from '@/lib/editor/from-assets'

const src = (file: string) => readFileSync(path.join(__dirname, '..', file), 'utf8')

describe('opening files in the manual editor', () => {
  it('parses the ids and format from the link safely', () => {
    expect(parseAssetIds('a1,b2,a1, ,../x,c_3-4')).toEqual(['a1', 'b2', 'c_3-4'])
    expect(parseAssetIds(null)).toEqual([])
    expect(parseAssetIds(Array.from({ length: 40 }, (_, i) => `id${i}`).join(',')).length).toBe(20)
    expect(parseFormat('9:16')).toBe('9:16'); expect(parseFormat('banana')).toBe('16:9'); expect(parseFormat(null)).toBe('16:9')
  })
  it('puts videos and images on the picture track in order and audio on its own tracks', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' })
    const c = compositionFromAssets({ title: 'T', format: '9:16', assets: [
      { id: 'v', asset_type: 'video', durationMs: 6200 }, { id: 'i', asset_type: 'image', durationMs: null }, { id: 'long', asset_type: 'video', durationMs: 999_999_999 },
      { id: 'm', asset_type: 'music', durationMs: 8000 }, { id: 'fx', asset_type: 'sfx', durationMs: 1200 }, { id: 'vo', asset_type: 'voice', durationMs: null }, { id: 'doc', asset_type: 'subtitle', durationMs: null },
    ] })
    expect(c).toMatchObject({ format: '9:16', title: 'T', editedManually: true })
    expect(c.clips.map(k => [k.visualAssetId, k.durationMs])).toEqual([['v', 6200], ['i', 5000], ['long', 120000]])
    expect(c.audioClips!.map(a => [a.assetId, a.kind, a.startMs, a.durationMs])).toEqual([['m', 'music', 0, 8000], ['fx', 'sfx', 0, 1200], ['vo', 'voice', 0, 10000]])
    expect(c.audioClips![0].volume).toBeLessThan(1)
    vi.unstubAllGlobals()
  })
  it('builds the links used by Studio, Library and the import screen', () => {
    expect(manualEditorHref('p1', ['a', 'b'])).toBe('/editor/manual?project=p1&assets=a,b')
    expect(manualEditorHref('p1', ['a'], '9:16')).toBe('/editor/manual?project=p1&assets=a&format=9:16')
  })
})

describe('regression: "Abrir" in the manual editor did nothing', () => {
  // The editor reads ?job= once, when it mounts. A client-side <Link> from /editor/manual to /editor/manual?job=… keeps the
  // page mounted, so nothing loaded. The list must use plain anchors (a full navigation).
  it('the saved-edit list opens edits with a plain anchor, not a client-side Link', () => {
    const picker = src('app/components/manual-picker.tsx')
    expect(picker).toMatch(/<a className="buttonLink ghost" href=\{`\/editor\/manual\?job=\$\{d\.id\}`\}>Abrir<\/a>/)
    expect(picker).not.toMatch(/<Link[^>]*editor\/manual\?job/)
  })
  it('every entry point to the manual editor uses the shared link builder', () => {
    for (const file of ['app/studio/page.tsx', 'app/library/page.tsx', 'app/components/flow-import.tsx']) expect(src(file), file).toContain('manualEditorHref(')
  })
  it('the Studio no longer sends an imported video to the automatic scene editor as its only option', () => {
    const studio = src('app/studio/page.tsx')
    expect(studio).toContain('Editar en el Editor manual')
    expect(studio).not.toMatch(/>Usar en el editor</)
  })
})
