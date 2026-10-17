import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDerivedVideo } from '@/lib/editor/client'

function fakeSupabase(source: Record<string, unknown> | null) {
  const calls: any[] = []
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    storage: { from: () => ({ upload: async (path: string) => { calls.push({ op: 'upload', path }); return { error: null } }, remove: async () => ({ error: null }) }) },
    from: (table: string) => ({
      select: () => { const q: any = { eq: () => q, maybeSingle: async () => ({ data: source, error: null }) }; return q },
      insert: (row: any) => { calls.push({ op: 'insert', table, row }); return { select: () => ({ single: async () => ({ data: { id: 'derived-1' }, error: null }) }) } },
    }),
  } as any
  return { calls, client }
}

describe('saving a converted copy of a render', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      const b = JSON.parse(init.body)
      return new Response(JSON.stringify({ driver: 'supabase', storagePath: `user-1/${b.projectId}/${b.folder}/${b.name}.${b.ext}`, maxBytes: 50 * 1024 * 1024 }))
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the license and lineage of the original and records how it was converted', async () => {
    const { client, calls } = fakeSupabase({ id: 'src1', license_status: 'licensed', source_provider: 'browser-render', provenance: { title: 'Documental · 9:16', mimeType: 'video/webm;codecs=vp9,opus', purpose: 'short', inputs: [{ id: 'a' }] } })
    const out = await saveDerivedVideo(client, { projectId: 'p1', sourceAssetId: 'src1', blob: new Blob([new Uint8Array(100)]), mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', codecs: { video: 'h264', audio: 'aac' }, tool: 'ffmpeg.wasm' })
    expect(out.id).toBe('derived-1')
    expect(calls.find(c => c.op === 'upload').path).toBe('user-1/p1/renders/src1-h264.mp4')
    const row = calls.find(c => c.op === 'insert').row
    expect(row).toMatchObject({ owner_id: 'user-1', project_id: 'p1', asset_type: 'video', source_provider: 'browser-transcode', license_status: 'licensed' })
    expect(row.provenance).toMatchObject({ derivedFromAssetId: 'src1', container: 'mp4', purpose: 'short', inputs: [{ id: 'a' }] })
    expect(row.provenance.mimeType).toContain('avc1')
    expect(row.provenance.conversion).toMatchObject({ tool: 'ffmpeg.wasm', from: 'video/webm;codecs=vp9,opus', codecs: { video: 'h264', audio: 'aac' } })
    expect(row.provenance.conversion.note).toMatch(/Recodificado/)
  })
  it('refuses when the original is not the owner\'s', async () => {
    const { client } = fakeSupabase(null)
    await expect(saveDerivedVideo(client, { projectId: 'p1', sourceAssetId: 'nope', blob: new Blob([new Uint8Array(1)]), mimeType: 'video/mp4', codecs: { video: null, audio: null }, tool: 'ffmpeg.wasm' })).rejects.toThrow(/No se encontró/)
  })
})
