// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { INCOMPLETE_VIDEO_MESSAGE, isIncompleteVideo } from '@/lib/publication/incomplete'

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8')

describe('vídeos incompletos nunca se aprueban ni se publican', () => {
  it('detecta la marca de procedencia', () => {
    expect(isIncompleteVideo({ incomplete: true })).toBe(true)
    expect(isIncompleteVideo({ incomplete: false })).toBe(false)
    expect(isIncompleteVideo(null)).toBe(false)
    expect(INCOMPLETE_VIDEO_MESSAGE).toMatch(/incompleto/)
  })
  // Análisis estático (no ejecuta las rutas): garantiza que la comprobación sigue presente en los puntos de aprobación y publicación.
  it.each([
    'app/api/publish/youtube/[jobId]/approve/route.ts',
    'app/api/publish/social/[jobId]/approve/route.ts',
    'lib/publication/social.ts',
  ])('%s usa isIncompleteVideo', file => { expect(read(file)).toMatch(/isIncompleteVideo\(/) })
  it('YouTube (publicación) mantiene su comprobación', () => { expect(read('lib/publication/youtube.ts')).toMatch(/incomplete === true/) })
})
