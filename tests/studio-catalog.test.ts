import { describe, expect, it } from 'vitest'
import { catalog, falEndpoint, falInput, falOutputs, isConfigured, modelById } from '@/lib/providers/catalog'
import { safeQueueUrl } from '@/lib/providers/fal-queue'

const m = (id: string) => { const x = modelById(id); if (!x) throw new Error(id); return x }

describe('creation studio catalogue', () => {
  it('covers every modality with unique ids', () => {
    expect(new Set(catalog.map(c => c.id)).size).toBe(catalog.length)
    expect(new Set(catalog.map(c => c.modality))).toEqual(new Set(['image', 'video', 'voice', 'music', 'sfx', 'ambient']))
  })
  it('is only usable when every required env var is set', () => {
    const flux = m('fal:fal-ai/flux-2-pro')
    expect(isConfigured(flux, {})).toBe(false)
    expect(isConfigured(flux, { FAL_KEY: '  ' })).toBe(false)
    expect(isConfigured(flux, { FAL_KEY: 'k' })).toBe(true)
  })
  it('maps formats to each documented fal field', () => {
    expect(falInput(m('fal:fal-ai/flux-2-pro'), 'p', { format: '9:16' })).toMatchObject({ image_size: 'portrait_16_9' })
    expect(falInput(m('fal:fal-ai/nano-banana-pro'), 'p', { format: '16:9', variants: 9 })).toMatchObject({ aspect_ratio: '16:9', num_images: 4 })
    expect(falInput(m('fal:fal-ai/veo3/fast'), 'p', { format: '1:1', durationSeconds: 6, audio: false })).toMatchObject({ aspect_ratio: '16:9', duration: '6s', generate_audio: false })
    expect(falInput(m('fal:fal-ai/kling-video/v2.5-turbo/pro/text-to-video'), 'p', { durationSeconds: 7 })).toMatchObject({ duration: '5' })
  })
  it('only sends a negative prompt to models that accept one', () => {
    expect(falInput(m('fal:fal-ai/flux-2-pro'), 'p', {}, 'text')).not.toHaveProperty('negative_prompt')
    expect(falInput(m('fal:fal-ai/ideogram/v3'), 'p', {}, ' text ')).toMatchObject({ negative_prompt: 'text' })
  })
  it('estimates cost from the options the user picked', () => {
    expect(m('fal:fal-ai/veo3/fast').estimateUsd({ durationSeconds: 8, audio: true })).toBeCloseTo(1.2)
    expect(m('fal:fal-ai/veo3/fast').estimateUsd({ durationSeconds: 4, audio: false })).toBeCloseTo(0.4)
    expect(m('fal:fal-ai/nano-banana-pro').estimateUsd({ variants: 3 })).toBeCloseTo(0.45)
    expect(m('openai:gpt-image-1').estimateUsd({ quality: 'high' })).toBeGreaterThan(m('openai:gpt-image-1').estimateUsd({}))
  })
  it('reads fal outputs and ignores non-https urls', () => {
    expect(falOutputs({ images: [{ url: 'https://v3.fal.media/a.png' }, { url: 'http://x/b.png' }] }, 'image')).toEqual([{ url: 'https://v3.fal.media/a.png', contentType: 'image/png' }])
    expect(falOutputs({ video: { url: 'https://v3.fal.media/v.mp4', content_type: 'video/mp4' } }, 'video')).toHaveLength(1)
    expect(falOutputs({ audio: { url: 'https://v3.fal.media/m.wav' } }, 'music')[0].contentType).toBe('audio/wav')
    expect(falOutputs(null, 'image')).toEqual([])
  })
  it('never polls outside fal queue host', () => {
    expect(safeQueueUrl('https://queue.fal.run/fal-ai/veo3/requests/abc/status')).toContain('queue.fal.run')
    expect(safeQueueUrl('https://evil.example/queue.fal.run')).toBeNull()
    expect(safeQueueUrl('http://queue.fal.run/x')).toBeNull()
    expect(falEndpoint(m('fal:fal-ai/lyria2'))).toBe('fal-ai/lyria2')
  })
})
