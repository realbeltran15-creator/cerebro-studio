import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Plantillas: compatibilidad de huecos', () => {
  const src = readFileSync('app/editor/templates/page.tsx', 'utf8')
  it('filtra las opciones por tipo de recurso del hueco', () => {
    expect(src).toContain('ACCEPTS[s.kind].includes(a.asset_type)')
  })
  it('descarta asignaciones incompatibles antes de montar', () => {
    expect(src).toContain('safeAssign')
    expect(src).toMatch(/fillTemplate\(t, safeAssign/)
  })
  it('un hueco de música no admite vídeo ni imagen; uno visual no admite audio', () => {
    expect(src).toMatch(/music: \['music', 'audio'\]/)
    expect(src).toMatch(/visual: \['video', 'image', 'thumbnail'\]/)
  })
})
