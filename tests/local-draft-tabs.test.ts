import { describe, expect, it } from 'vitest'
import type { Composition } from '@/lib/editor/composition'
import { dropDraft, newestDraft, putDraft, toRecord, type LocalDraft } from '@/lib/editor/local-draft'

const draft = (savedAt: string, title: string): LocalDraft => ({ jobId: 'j', composition: { title } as unknown as Composition, savedAt, baseUpdatedAt: null })

describe('borradores locales por pestaña (doble pestaña, cierre inesperado)', () => {
  it('dos pestañas escriben a la vez sin pisarse', () => {
    let rec = toRecord(null, 'j')
    rec = putDraft(rec, 'A', draft('2026-10-24T10:00:00Z', 'de A'))
    rec = putDraft(rec, 'B', draft('2026-10-24T10:01:00Z', 'de B'))
    expect(Object.keys(rec.drafts).sort()).toEqual(['A', 'B'])
  })
  it('el guardado correcto de A borra solo el borrador de A (el de B sobrevive)', () => {
    let rec = putDraft(putDraft(toRecord(null, 'j'), 'A', draft('2026-10-24T10:00:00Z', 'A')), 'B', draft('2026-10-24T10:01:00Z', 'B'))
    rec = dropDraft(rec, 'A')
    expect(Object.keys(rec.drafts)).toEqual(['B'])
    expect((newestDraft(rec)!.composition as unknown as { title: string }).title).toBe('B')
  })
  it('cierre inesperado de B: otra pestaña puede recuperar su borrador (el más reciente)', () => {
    const rec = putDraft(putDraft(toRecord(null, 'j'), 'A', draft('2026-10-24T10:00:00Z', 'viejo')), 'B', draft('2026-10-24T10:05:00Z', 'nuevo'))
    expect((newestDraft(rec)!.composition as unknown as { title: string }).title).toBe('nuevo')
  })
  it('descartar todas las copias; formato antiguo se migra sin perderlo', () => {
    const legacy = { jobId: 'j', composition: { title: 'antiguo' }, savedAt: '2026-10-01T00:00:00Z', baseUpdatedAt: null }
    const rec = toRecord(legacy, 'j')
    expect(newestDraft(rec)).not.toBeNull()
    expect(newestDraft(dropDraft(rec, 'all'))).toBeNull()
    expect(newestDraft(toRecord(undefined, 'j'))).toBeNull()
  })
})
