import { describe, expect, it } from 'vitest'
import { outputLicense, saveRender } from '@/lib/editor/client'
import { emptyComposition, toShort } from '@/lib/editor/composition'

function fakeSupabase() {
  const calls: any[] = []
  const table = (name: string) => ({
    insert: (row: any) => { calls.push({ op: 'insert', table: name, row }); return { select: () => ({ single: async () => ({ data: { id: 'asset-1' }, error: null }) }) } },
    update: (row: any) => ({ eq: async (col: string, val: string) => { calls.push({ op: 'update', table: name, row, where: [col, val] }); return { error: null } } }),
  })
  return {
    calls,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      storage: { from: () => ({ upload: async (path: string, _b: Blob, opts: any) => { calls.push({ op: 'upload', path, opts }); return { error: null } }, remove: async () => ({ error: null }) }) },
      from: table,
    } as any,
  }
}

describe('saving a render to the Biblioteca', () => {
  const comp = emptyComposition('sb1', 'Documental')
  comp.clips = [
    { id: 'a', sceneId: 'a', position: 1, narration: 'uno', visualAssetId: 'img', voiceAssetId: 'voz', durationMs: 4888, motion: 'kenburns', focusX: 0.5 },
    { id: 'b', sceneId: 'b', position: 2, narration: 'dos', visualAssetId: 'img', voiceAssetId: null, durationMs: 13000, motion: 'kenburns', focusX: 0.5 },
  ]
  const assets = [
    { id: 'img', asset_type: 'image', storage_path: 'p', license_status: 'generated', source_provider: 'openai-image', provenance: {}, created_at: '' },
    { id: 'voz', asset_type: 'voice', storage_path: 'p', license_status: 'generated', source_provider: 'openai-voice', provenance: {}, created_at: '' },
    { id: 'unused', asset_type: 'music', storage_path: 'p', license_status: 'unknown', source_provider: 'upload', provenance: {}, created_at: '' },
  ] as any

  it('uploads the WebM, records provenance, licenses and settings, and completes the job', async () => {
    const { client, calls } = fakeSupabase()
    await saveRender(client, { projectId: 'p1', jobId: 'job-1', composition: comp, blob: new Blob([new Uint8Array(10)], { type: 'video/webm' }), mimeType: 'video/webm;codecs=vp9,opus', durationMs: 17888, assets })
    expect(calls[0]).toMatchObject({ op: 'upload', path: 'user-1/p1/renders/job-1.webm', opts: { contentType: 'video/webm', upsert: false } })
    const row = calls.find(c => c.op === 'insert').row
    expect(row).toMatchObject({ asset_type: 'video', source_provider: 'browser-render', license_status: 'generated', project_id: 'p1' })
    expect(row.provenance).toMatchObject({ purpose: 'render', renderJobId: 'job-1', durationMs: 17888, settings: { clips: 2, fadeMs: 300, subtitles: true } })
    expect(row.provenance.inputs.map((i: any) => i.id).sort()).toEqual(['img', 'voz'])
    expect(calls.at(-1)).toMatchObject({ op: 'update', table: 'render_jobs', row: { status: 'completed', output_asset_id: 'asset-1' }, where: ['id', 'job-1'] })
  })

  it('marks a Short with its source edit and hook', async () => {
    const { client, calls } = fakeSupabase()
    const short = toShort(comp, 'job-source', ['a'], 'Imagina vivir sin hablar')
    await saveRender(client, { projectId: 'p1', jobId: 'job-2', composition: short, blob: new Blob([new Uint8Array(4)]), mimeType: 'video/webm', durationMs: 4888, assets })
    const row = calls.find(c => c.op === 'insert').row
    expect(row.provenance).toMatchObject({ purpose: 'short', format: '9:16', settings: { hookText: 'Imagina vivir sin hablar', sourceJobId: 'job-source' } })
  })

  it('derives the output license from the inputs', () => {
    expect(outputLicense([{ license_status: 'generated' }, { license_status: 'owned' }])).toBe('generated')
    expect(outputLicense([{ license_status: 'licensed' }, { license_status: 'generated' }])).toBe('licensed')
    expect(outputLicense([{ license_status: 'owned' }, { license_status: 'unknown' }])).toBe('unknown')
    expect(outputLicense([{ license_status: 'public_domain' }])).toBe('owned')
  })
})
