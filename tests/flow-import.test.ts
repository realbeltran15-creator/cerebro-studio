import { describe, expect, it } from 'vitest'
import { driveDownloadUrl, flowLicense, flowProvenance, followUps, pickedProblem, pickerConfigFromEnv, FLOW_MAX_BYTES } from '@/lib/flow-import'

describe('pickerConfigFromEnv', () => {
  const ok = { clientId: '123456789012-abcdef0123456789.apps.googleusercontent.com', apiKey: `AIza${'x'.repeat(35)}`, appId: '123456789012' }
  it('accepts the three public identifiers', () => expect(pickerConfigFromEnv(ok)).toEqual(ok))
  it.each([['clientId', 'nope'], ['apiKey', 'AIza-short'], ['appId', 'abc'], ['clientId', ''], ['apiKey', undefined]])('rejects a bad %s (%s)', (key, value) => {
    expect(pickerConfigFromEnv({ ...ok, [key]: value as string | undefined })).toBeNull()
  })
})

describe('pickedProblem', () => {
  const base = { id: 'abcdEFGH_12-345', name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 1000 }
  it('accepts a normal video', () => expect(pickedProblem(base)).toBeNull())
  it('refuses folders, documents and other types', () => {
    expect(pickedProblem({ ...base, mimeType: 'application/vnd.google-apps.folder' })).toMatch(/Solo se importan/)
    expect(pickedProblem({ ...base, mimeType: 'application/pdf' })).toMatch(/Solo se importan/)
  })
  it('refuses oversized files and malformed ids', () => {
    expect(pickedProblem({ ...base, sizeBytes: FLOW_MAX_BYTES + 1 })).toMatch(/Supera/)
    expect(pickedProblem({ ...base, id: '../etc/passwd' })).toMatch(/no válido/)
  })
})

describe('driveDownloadUrl', () => {
  it('builds the official media URL without any token in it', () => {
    const url = driveDownloadUrl('abcdEFGH_12-345')
    expect(url).toBe('https://www.googleapis.com/drive/v3/files/abcdEFGH_12-345?alt=media&supportsAllDrives=true')
    expect(url).not.toMatch(/access_token|key=/)
  })
  it('rejects ids that could change the path or query', () => {
    for (const bad of ['a/b', 'abc?x=1', 'short', '..%2f..%2fx12345']) expect(() => driveDownloadUrl(bad)).toThrow()
  })
})

describe('licence and provenance', () => {
  it('is restricted until the user confirms the origin, owned afterwards with the caveat recorded', () => {
    expect(flowLicense(false).status).toBe('restricted')
    const l = flowLicense(true)
    expect(l.status).toBe('owned')
    expect(l.notes).toMatch(/no puede comprobar/)
  })
  it('records source, declared origin and Instagram readiness from the real codecs', () => {
    const h264 = flowProvenance({ originalFilename: 'a.mp4', mime: 'video/mp4', source: { kind: 'drive', fileId: 'abcdEFGH_12-345' }, codec: { video: 'h264', audio: 'aac' }, prompt: '  a fox  ' })
    expect(h264).toMatchObject({ importedFrom: 'google-drive-picker', driveFileId: 'abcdEFGH_12-345', declaredOrigin: 'google-flow', aiGenerated: true, prompt: 'a fox', instagramReady: true })
    const vp9 = flowProvenance({ originalFilename: 'b.mp4', mime: 'video/mp4', source: { kind: 'local' }, codec: { video: 'vp9', audio: 'opus' } })
    expect(vp9).toMatchObject({ importedFrom: 'local-file', driveFileId: null, instagramReady: false })
    expect(vp9.instagramNote).toMatch(/VP9/)
    expect(flowProvenance({ originalFilename: 'c.webm', mime: 'video/webm', source: { kind: 'local' } }).instagramReady).toBe(false)
    expect(flowProvenance({ originalFilename: 'd.mp4', mime: 'video/mp4', source: { kind: 'local' }, codec: null }).instagramReady).toBeNull()
  })
  it('describes what happens next, adding the conversion only when needed', () => {
    const mk = (video: string | null) => followUps(flowProvenance({ originalFilename: 'x.mp4', mime: 'video/mp4', source: { kind: 'local' }, codec: { video, audio: null } }))
    expect(mk('h264').join(' ')).toMatch(/Editor manual/)
    expect(mk('h264').join(' ')).not.toMatch(/convertirlo/)
    expect(mk('vp9').join(' ')).toMatch(/convertirlo a MP4 H\.264/)
    expect(mk(null).join(' ')).toMatch(/No se pudo leer el códec/)
  })
})
