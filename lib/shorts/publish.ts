import type { YouTubePayload } from '@/lib/publication/youtube'

/**
 * What the approval screen sends to the existing publication flow. Fixed on purpose: every factory Short is uploaded as PRIVATE,
 * declared as altered/synthetic content (the voice and images are AI-generated) and not made for kids. The owner approves each one.
 */
export type ShortPlan = { title?: string; description?: string; hashtags?: string[] }
export type SourceForDescription = { url: string; status?: string }

const clean = (s: string) => s.replace(/[<>]/g, '').trim()

export function shortPayload(plan: ShortPlan, sources: SourceForDescription[], videoAssetId: string): YouTubePayload {
  const accepted = sources.filter(s => !s.status || s.status === 'accepted').map(s => s.url)
  const tags = (plan.hashtags ?? []).map(h => h.replace(/^#/, '')).filter(Boolean)
  const hashtags = ['Shorts', ...tags].map(t => `#${t}`).join(' ')
  const description = clean([
    plan.description ?? '',
    accepted.length ? `Fuentes:\n${accepted.map(u => `- ${u}`).join('\n')}` : '',
    'Contenido creado con ayuda de IA (voz e imágenes sintéticas).',
    hashtags,
  ].filter(Boolean).join('\n\n')).slice(0, 4900)
  const title = clean(plan.title ?? '').slice(0, 90)
  return { title: title.includes('#Shorts') ? title : `${title} #Shorts`.slice(0, 100), description, tags: tags.slice(0, 10), privacyStatus: 'private', categoryId: '27', madeForKids: false, containsSyntheticMedia: true, videoAssetId, thumbnailAssetId: null }
}

export const idempotencyKeyFor = (itemId: string) => `shorts-factory-${itemId}`

export function approvalSummary(topic: string, payload: YouTubePayload, sourceCount: number) {
  return [
    `Short: ${topic}`,
    `Privacidad: privado (podrás hacerlo público tú desde YouTube)`,
    `Contenido sintético declarado: ${payload.containsSyntheticMedia ? 'sí' : 'no'}`,
    `Fuentes verificadas: ${sourceCount}`,
    'Coste de generación: 0 USD (solo recursos gratuitos)',
  ].join(' · ')
}
