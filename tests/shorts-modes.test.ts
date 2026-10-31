import { describe, expect, it } from 'vitest'
import { applyFlowClips, flowPromptPack, parseShortsInstruction, veoEstimate } from '@/lib/shorts/modes'
import { emptyComposition, type Clip } from '@/lib/editor/composition'

const clip = (id: string, v: string | null): Clip => ({ id, sceneId: id, position: 0, narration: 'n', visualAssetId: v, voiceAssetId: null, durationMs: 3000, motion: 'kenburns', focusX: 0.5, transition: 'cut', text: null } as Clip)
const comp = () => ({ ...emptyComposition('s', 't', '9:16'), clips: [clip('a', 'img1'), clip('b', 'img2'), clip('c', null)] })

describe('shorts modes', () => {
  it('parses the instruction', () => {
    expect(parseShortsInstruction('Hazlo con Flow')).toBe('flow')
    expect(parseShortsInstruction('usa VEO')).toBe('veo')
    expect(parseShortsInstruction('hazlo gratis')).toBe('free')
    expect(parseShortsInstruction('con flow, nada de gratis')).toBe('flow')
    expect(parseShortsInstruction('un dato curioso')).toBeNull()
  })
  it('builds locked-camera vertical prompts', () => {
    const p = flowPromptPack({ title: '', description: '', hashtags: [], scenes: [{ narration: 'x', visual: 'Un faro de noche', onScreenText: '' }] })
    expect(p[0].prompt).toMatch(/9:16/); expect(p[0].prompt).toMatch(/Cámara fija/)
  })
  it('applies flow clips by scene then by order, leaving others untouched', () => {
    const r = applyFlowClips(comp(), [
      { id: 'v1', asset_type: 'video', source_provider: 'google-flow-import', provenance: { sceneId: 'b' }, created_at: '1' },
      { id: 'v2', asset_type: 'video', source_provider: 'google-flow-import', provenance: {}, created_at: '2' },
      { id: 'x', asset_type: 'image', source_provider: 'google-flow-import' },
    ])
    expect(r.applied).toBe(2)
    expect(r.composition.clips.map(c => c.visualAssetId)).toEqual(['v2', 'v1', null])
  })
  it('estimates Veo cost', () => { expect(veoEstimate(6, 'fast')).toBe(4.8) })
})
