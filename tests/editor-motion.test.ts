import { describe, expect, it } from 'vitest'
import { textFrame, transitionFrame } from '@/lib/editor/motion'
import { parseComposition } from '@/lib/editor/composition'

describe('transitions', () => {
  it('start showing only the outgoing clip and end showing only the incoming one', () => {
    for (const k of ['dissolve', 'slide', 'wipe', 'zoom'] as const) {
      const a = transitionFrame(k, 0), b = transitionFrame(k, 1)
      const startVisible = a.bAlpha === 0 || a.bOffsetX === 1 || a.bReveal === 0
      expect(startVisible, k).toBe(true)
      expect(b.bAlpha).toBe(1); expect(b.bOffsetX).toBe(0); expect(b.bReveal).toBe(1)
    }
    expect(transitionFrame('zoom', 1).aScale).toBeCloseTo(1.35)
    expect(transitionFrame('slide', 0.5).bOffsetX).toBeCloseTo(0.5)
  })
  it('clamps out-of-range progress', () => {
    expect(transitionFrame('dissolve', 2).bAlpha).toBe(1)
    expect(transitionFrame('dissolve', -1).bAlpha).toBe(0)
  })
})

describe('text animations', () => {
  it('none is always fully visible', () => expect(textFrame('none', 0, 3000, 10)).toEqual({ alpha: 1, scale: 1, offsetY: 0, visibleChars: null }))
  it('fade/slide/pop enter, hold fully readable, and fade out at the end', () => {
    for (const a of ['fade', 'slide', 'pop'] as const) {
      expect(textFrame(a, 0, 4000, 10).alpha, a).toBe(0)
      expect(textFrame(a, 2000, 4000, 10), a).toEqual({ alpha: 1, scale: 1, offsetY: 0, visibleChars: null })
      expect(textFrame(a, 4000, 4000, 10).alpha, a).toBe(0)
    }
    expect(textFrame('pop', 300, 4000, 10).scale).toBeGreaterThan(1)
  })
  it('typewriter types the text then holds it', () => {
    expect(textFrame('typewriter', 0, 5000, 20).visibleChars).toBe(0)
    expect(textFrame('typewriter', 1000, 5000, 20).visibleChars).toBe(10)
    expect(textFrame('typewriter', 3000, 5000, 20).visibleChars).toBe(20)
  })
  it('short clips still show the text fully at the middle', () => expect(textFrame('fade', 300, 600, 5).alpha).toBe(1))
})

describe('composition parsing', () => {
  it('keeps the new transitions and text animations and rejects unknown ones', () => {
    const c = parseComposition({ version: 1, storyboardId: 's', format: '16:9', clips: [
      { id: 'a', sceneId: 'a', position: 0, durationMs: 3000, transition: 'slide', text: { content: 'Hola', position: 'top', sizePct: 6, animation: 'typewriter' } },
      { id: 'b', sceneId: 'b', position: 1, durationMs: 3000, transition: 'spin', text: { content: 'X', animation: 'explode' } },
    ] })!
    expect(c.clips[0].transition).toBe('slide'); expect(c.clips[0].text?.animation).toBe('typewriter')
    expect(c.clips[1].transition).toBe('fade'); expect(c.clips[1].text?.animation).toBe('none')
  })
})
