import { describe, expect, it } from 'vitest'
import { editorHrefForStoryboard } from '@/lib/editor/open-in-editor'
describe('editorHrefForStoryboard', () => {
  it('codifica ids y apunta al editor con project y storyboard', () => {
    expect(editorHrefForStoryboard('p 1', 's&2')).toBe('/editor?project=p%201&storyboard=s%262')
  })
})
