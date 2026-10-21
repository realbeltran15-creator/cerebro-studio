import { describe, expect, it } from 'vitest'
import { addTag, allTags, autoTags, createCollection, EMPTY_ORG, forgetAsset, normalizeTag, parseOrg, relatedAssets, removeTag, toggleInCollection } from '@/lib/library-org'
import type { LibraryAsset } from '@/lib/library'

const asset = (id: string, extra: Partial<LibraryAsset> = {}): LibraryAsset => ({ id, asset_type: 'video', project_id: 'p1', storage_path: `x/${id}`, source_provider: null, source_url: null, license_status: 'owned', provenance: {}, created_at: '2026-10-01', ...extra })

describe('library organisation', () => {
  it('normalises tags, avoids duplicates and removes them', () => {
    expect(normalizeTag('  #Intro  LOFI ')).toBe('intro lofi')
    let o = addTag(EMPTY_ORG, 'a', '#Lofi'); o = addTag(o, 'a', 'lofi'); o = addTag(o, 'a', 'Noche')
    expect(o.tags.a).toEqual(['lofi', 'noche'])
    expect(allTags(addTag(o, 'b', 'Aire'))).toEqual(['aire', 'lofi', 'noche'])
    expect(removeTag(removeTag(o, 'a', 'lofi'), 'a', 'noche').tags.a).toBeUndefined()
  })
  it('creates collections once per name, toggles membership and forgets deleted files', () => {
    let o = createCollection(EMPTY_ORG, 'Intros', 'c1')
    expect(createCollection(o, 'intros', 'c2')).toBe(o)
    o = toggleInCollection(addTag(o, 'a', 'x'), 'c1', 'a')
    expect(o.collections[0].assetIds).toEqual(['a'])
    o = forgetAsset(o, 'a')
    expect(o.collections[0].assetIds).toEqual([]); expect(o.tags.a).toBeUndefined()
  })
  it('parses stored data defensively', () => {
    expect(parseOrg({ tags: { a: ['OK', 3, ''] , b: 'x' }, collections: [{ id: 'c', name: ' Mi colección ', assetIds: ['a', 'a', 1] }, { name: 'sin id' }] }))
      .toEqual({ tags: { a: ['ok'] }, collections: [{ id: 'c', name: 'Mi colección', assetIds: ['a'] }] })
    expect(parseOrg(null)).toEqual(EMPTY_ORG)
  })
  it('derives automatic tags and relations from the files themselves', () => {
    const src = asset('src', { provenance: { durationMs: 900_000 } })
    const short = asset('short', { source_provider: 'browser-render', provenance: { format: '9:16', durationMs: 40_000, inputs: [{ id: 'src' }], purpose: 'render' } })
    const sub = asset('sub', { asset_type: 'subtitle', provenance: { sourceAssetId: 'src' } })
    expect(autoTags(short)).toEqual(expect.arrayContaining(['montaje', 'vertical', 'corto (≤ 60 s)', 'short', 'derivado']))
    expect(autoTags(src)).toContain('largo (> 10 min)')
    const r = relatedAssets(src, [src, short, sub])
    expect(r.derived.map(a => a.id).sort()).toEqual(['short', 'sub'])
    expect(relatedAssets(short, [src, short, sub]).madeFrom.map(a => a.id)).toEqual(['src'])
  })
})
