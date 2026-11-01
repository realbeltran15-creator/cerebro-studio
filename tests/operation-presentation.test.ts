import { describe, expect, it } from 'vitest'
import { automationRunView, generationJobView, publicationView, renderJobView, shortItemView } from '@/lib/operation-presentation'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('publicationView', () => {
  it('publicado con id = verificado; sin id o con comprobación que no coincide = incierto', () => {
    expect(publicationView({ status: 'published', result: { videoId: 'x', url: 'u' } }).state).toBe('verified')
    expect(publicationView({ status: 'published', result: {} }).state).toBe('uncertain')
    expect(publicationView({ status: 'published', result: { videoId: 'x', youtubeCheck: { exists: true, matches: false } } }).state).toBe('uncertain')
    expect(publicationView({ status: 'published', result: { videoId: 'x', youtubeCheck: { exists: false } } }).state).toBe('uncertain')
    expect(publicationView({ status: 'published', result: { videoId: 'x', youtubeCheck: { exists: true, matches: true } } }).state).toBe('verified')
  })
  it('interrumpido (vuelve a aprobado con interruptedAt) es incierto, aprobado normal es preparado', () => {
    expect(publicationView({ status: 'approved', result: { interruptedAt: ago(1000) } }).state).toBe('uncertain')
    expect(publicationView({ status: 'approved', result: {} }).state).toBe('prepared')
    expect(publicationView({ status: 'publishing', result: { interruptedAt: ago(1000) } }).state).toBe('uncertain')
  })
  it('fallo, cancelación, ejecución y aprobación pendiente se muestran aparte', () => {
    expect(publicationView({ status: 'failed', result: { videoId: 'x' } }).state).toBe('failed')
    expect(publicationView({ status: 'cancelled' }).state).toBe('cancelled')
    expect(publicationView({ status: 'publishing' }).state).toBe('running')
    expect(publicationView({ status: 'awaiting_approval' }).state).toBe('awaiting_approval')
    expect(publicationView({ status: 'draft' }).state).toBe('prepared')
  })
  it('reintento tras interrupción que termina bien: ya no es incierto', () => {
    expect(publicationView({ status: 'published', result: { interruptedAt: ago(5000), videoId: 'v' } }).state).toBe('verified')
  })
  it('red caída: estado desconocido nunca es completado', () => {
    expect(publicationView({ status: 'loquesea', result: { videoId: 'x' } }).state).toBe('uncertain')
  })
})

describe('generationJobView', () => {
  it('aprobado necesita archivo guardado', () => {
    expect(generationJobView({ status: 'approved', output_asset_id: 'a' }).state).toBe('verified')
    expect(generationJobView({ status: 'approved', output_asset_id: null }).state).toBe('uncertain')
  })
  it('bloqueado, en revisión, en cola, ejecución, fallo y rechazo', () => {
    expect(generationJobView({ status: 'blocked' }).state).toBe('prepared')
    expect(generationJobView({ status: 'needs_review' }).state).toBe('awaiting_approval')
    expect(generationJobView({ status: 'queued' }).state).toBe('prepared')
    expect(generationJobView({ status: 'running' }).state).toBe('running')
    expect(generationJobView({ status: 'failed' }).state).toBe('failed')
    expect(generationJobView({ status: 'rejected' }).state).toBe('failed')
  })
})

describe('automationRunView', () => {
  const base = { error: null, finished_at: ago(1000) }
  it('correcta con cierre = verificada; con error o sin cierre = incierta', () => {
    expect(automationRunView({ ...base, status: 'succeeded', started_at: ago(5000) }).state).toBe('verified')
    expect(automationRunView({ ...base, status: 'succeeded', error: 'x', started_at: ago(5000) }).state).toBe('uncertain')
    expect(automationRunView({ status: 'succeeded', started_at: ago(5000), finished_at: null }).state).toBe('uncertain')
  })
  it('en curso reciente = en ejecución; tras 15 min = incierta (no se convierte en completada)', () => {
    expect(automationRunView({ status: 'running', started_at: ago(60_000) }).state).toBe('running')
    expect(automationRunView({ status: 'running', started_at: ago(16 * 60_000) }).state).toBe('uncertain')
  })
  it('fallida', () => { expect(automationRunView({ status: 'failed', started_at: ago(1000) }).state).toBe('failed') })
})

describe('shortItemView', () => {
  it('transiciones del Short', () => {
    expect(shortItemView({ status: 'prepared' }).state).toBe('awaiting_approval')
    expect(shortItemView({ status: 'approved' }).state).toBe('prepared')
    expect(shortItemView({ status: 'published' }, { videoId: 'v' }).state).toBe('verified')
    expect(shortItemView({ status: 'published' }, null).state).toBe('uncertain')
    expect(shortItemView({ status: 'discarded' }).state).toBe('cancelled')
    expect(shortItemView({ status: 'failed' }).state).toBe('failed')
  })
})

describe('renderJobView', () => {
  it('completado solo es verificado con archivo guardado', () => {
    expect(renderJobView({ status: 'completed', output_asset_id: 'a' }).state).toBe('verified')
    expect(renderJobView({ status: 'completed', output_asset_id: null }).state).toBe('uncertain')
  })
  it('interrumpido es incierto; fallo, cancelado, en ejecución y en cola', () => {
    expect(renderJobView({ status: 'failed', error: 'Interrumpido: la pestaña se cerró o recargó antes de terminar el render.' }).state).toBe('uncertain')
    expect(renderJobView({ status: 'failed', error: 'ffmpeg falló' }).state).toBe('failed')
    expect(renderJobView({ status: 'cancelled' }).state).toBe('cancelled')
    expect(renderJobView({ status: 'rendering' }).state).toBe('running')
    expect(renderJobView({ status: 'queued' }).state).toBe('prepared')
  })
})
