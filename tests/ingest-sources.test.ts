import { describe, expect, it } from 'vitest'
import { sourceStatuses } from '@/lib/ingest/sources'
import { viewsFor, DRIVE_AUDIO_MIMES } from '@/lib/ingest/drive'

describe('import sources', () => {
  it('only marks implemented sources as available and says why the others are not', () => {
    const off = sourceStatuses({ driveConfigured: false })
    expect(off.find(s => s.id === 'drive')?.state).toBe('needs_config')
    expect(sourceStatuses({ driveConfigured: true }).find(s => s.id === 'drive')?.state).toBe('available')
    expect(off.filter(s => s.state === 'available').map(s => s.id)).toEqual(['computer'])
    expect(off.find(s => s.id === 'icloud')?.state).toBe('unsupported')
  })
  it('the Drive picker opens on the right tab for each section', () => {
    expect(viewsFor('audio')[0]).toEqual({ label: 'Audio', mimes: DRIVE_AUDIO_MIMES })
    expect(viewsFor('audio').every(v => v.mimes.length > 0)).toBe(true)
    expect(viewsFor('all').map(v => v.label)).toEqual(['Todo', 'Audio', 'Vídeo', 'Imágenes'])
    expect(DRIVE_AUDIO_MIMES).toContain('audio/mpeg')
  })
})
