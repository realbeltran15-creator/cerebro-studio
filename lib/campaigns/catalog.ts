import type { Assumption, Goal, Mode, PlatformId, ResultMetric, Subject } from './types'

export const SUBJECTS: Array<[Subject, string]> = [['video', 'Un vídeo'], ['channel', 'Un canal'], ['product', 'Un producto'], ['store', 'Una tienda'], ['project', 'Un proyecto de Cerebro Studio'], ['other', 'Otra cosa']]
export const GOALS: Array<[Goal, string, string]> = [
  ['awareness', 'Notoriedad (que me conozcan)', 'Mide alcance e impresiones; el resultado es difícil de atribuir.'],
  ['views', 'Visualizaciones de un vídeo', 'Mide vistas y porcentaje visto.'],
  ['subscribers', 'Suscriptores / seguidores', 'Mide nuevos suscriptores o seguidores y su coste.'],
  ['traffic', 'Visitas a una web o tienda', 'Mide clics y visitas.'],
  ['leads', 'Contactos / registros', 'Mide registros, formularios o descargas.'],
  ['sales', 'Ventas', 'Mide pedidos e ingresos; exige seguimiento de conversiones.'],
  ['engagement', 'Interacción / comunidad', 'Mide comentarios, guardados y compartidos.'],
]
export const METRICS: Array<[ResultMetric, string]> = [['reach', 'Alcance'], ['views', 'Visualizaciones'], ['clicks', 'Clics'], ['subscribers', 'Suscriptores'], ['leads', 'Contactos'], ['sales', 'Ventas']]
export const GOAL_METRIC: Record<Goal, ResultMetric> = { awareness: 'reach', views: 'views', subscribers: 'subscribers', traffic: 'clicks', leads: 'leads', sales: 'sales', engagement: 'views' }
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const

export type PlatformInfo = {
  id: PlatformId; label: string; kind: 'organic' | 'paid'; network: 'youtube' | 'meta' | 'tiktok'
  /** Goals it handles well (editorial judgement, stated as such on screen). */
  fit: Partial<Record<Goal, number>>
  subjects: Partial<Record<Subject, number>>
  /** Example creative formats; always check the platform's current specification before producing. */
  formats: string[]
  needs: string
  kpis: Partial<Record<Goal, string[]>>
}

export const PLATFORMS: PlatformInfo[] = [
  { id: 'youtube_organic', label: 'YouTube (orgánico)', kind: 'organic', network: 'youtube',
    fit: { awareness: 3, views: 5, subscribers: 5, traffic: 2, leads: 1, sales: 1, engagement: 4 }, subjects: { video: 5, channel: 5, product: 2, store: 1, project: 4, other: 3 },
    formats: ['Vídeo largo con miniatura y título optimizados', 'Short vertical', 'Publicación de comunidad'], needs: 'Un canal propio; no tiene coste de medios.',
    kpis: { views: ['Visualizaciones', 'Porcentaje visto medio', 'CTR de impresiones'], subscribers: ['Suscriptores ganados', 'Suscriptores por vídeo'], awareness: ['Impresiones', 'Espectadores únicos'], engagement: ['Comentarios', 'Me gusta', 'Compartidos'] } },
  { id: 'instagram_organic', label: 'Instagram (orgánico)', kind: 'organic', network: 'meta',
    fit: { awareness: 3, views: 3, subscribers: 3, traffic: 2, leads: 2, sales: 2, engagement: 5 }, subjects: { video: 3, channel: 3, product: 4, store: 4, project: 3, other: 3 },
    formats: ['Reel vertical', 'Carrusel', 'Historias'], needs: 'Cuenta profesional; no tiene coste de medios.',
    kpis: { engagement: ['Guardados', 'Compartidos', 'Comentarios'], awareness: ['Alcance', 'Cuentas alcanzadas'], subscribers: ['Seguidores nuevos'] } },
  { id: 'tiktok_organic', label: 'TikTok (orgánico)', kind: 'organic', network: 'tiktok',
    fit: { awareness: 4, views: 4, subscribers: 3, traffic: 2, leads: 1, sales: 2, engagement: 4 }, subjects: { video: 4, channel: 4, product: 4, store: 3, project: 3, other: 3 },
    formats: ['Vídeo vertical corto con gancho en los primeros segundos'], needs: 'Cuenta TikTok; no tiene coste de medios.',
    kpis: { views: ['Visualizaciones', 'Porcentaje visto'], awareness: ['Alcance'], engagement: ['Compartidos', 'Comentarios'] } },
  { id: 'google_ads', label: 'Google Ads (YouTube y Búsqueda)', kind: 'paid', network: 'youtube',
    fit: { awareness: 4, views: 5, subscribers: 3, traffic: 4, leads: 4, sales: 4, engagement: 2 }, subjects: { video: 5, channel: 4, product: 4, store: 4, project: 3, other: 3 },
    formats: ['Anuncio de vídeo en YouTube', 'Anuncio de Búsqueda por palabras clave', 'Demand Gen'], needs: 'Cuenta de Google Ads con facturación; para integrar por API, token de desarrollador aprobado.',
    kpis: { views: ['Visualizaciones', 'Coste por visualización', 'Porcentaje visto'], awareness: ['Impresiones', 'Alcance', 'CPM'], traffic: ['Clics', 'CTR', 'CPC'], leads: ['Conversiones', 'Coste por conversión'], sales: ['Conversiones', 'ROAS', 'Coste por conversión'], subscribers: ['Suscriptores atribuidos', 'Coste por suscriptor'] } },
  { id: 'meta_ads', label: 'Meta Ads (Instagram y Facebook)', kind: 'paid', network: 'meta',
    fit: { awareness: 4, views: 3, subscribers: 3, traffic: 4, leads: 5, sales: 5, engagement: 4 }, subjects: { video: 3, channel: 3, product: 5, store: 5, project: 3, other: 3 },
    formats: ['Reel / vídeo vertical', 'Imagen o carrusel', 'Anuncios de catálogo'], needs: 'Cuenta publicitaria con método de pago y página vinculada; para integrar por API, app de Meta con permisos aprobados.',
    kpis: { awareness: ['Alcance', 'Frecuencia', 'CPM'], traffic: ['Clics en el enlace', 'CTR', 'CPC'], leads: ['Contactos', 'Coste por contacto'], sales: ['Compras', 'ROAS', 'Coste por compra'], engagement: ['Interacciones', 'Coste por interacción'], views: ['ThruPlays', 'Coste por ThruPlay'], subscribers: ['Seguidores nuevos'] } },
  { id: 'tiktok_ads', label: 'TikTok Ads', kind: 'paid', network: 'tiktok',
    fit: { awareness: 5, views: 4, subscribers: 3, traffic: 3, leads: 3, sales: 3, engagement: 4 }, subjects: { video: 4, channel: 3, product: 4, store: 3, project: 3, other: 3 },
    formats: ['Vídeo vertical nativo', 'Spark Ads (impulsar un vídeo orgánico propio)'], needs: 'Cuenta de TikTok Ads Manager con facturación; para integrar por API, app aprobada en TikTok for Business.',
    kpis: { awareness: ['Alcance', 'CPM'], views: ['Visualizaciones', 'Visualizaciones de 6 s', 'Coste por visualización'], traffic: ['Clics', 'CTR', 'CPC'], leads: ['Conversiones', 'Coste por conversión'], sales: ['Compras', 'Coste por compra'], engagement: ['Interacciones'], subscribers: ['Seguidores nuevos'] } },
]
export const platformInfo = (id: PlatformId) => PLATFORMS.find(p => p.id === id)!
export const modeOf = (platforms: PlatformId[]): Mode | null => {
  const paid = platforms.some(p => platformInfo(p).kind === 'paid'), organic = platforms.some(p => platformInfo(p).kind === 'organic')
  return paid && organic ? 'mixed' : paid ? 'paid' : organic ? 'organic' : null
}

/**
 * EXAMPLE assumptions per paid platform: cost per 1000 impressions (in the campaign currency) and click-through rate. They are
 * editorial starting points that make the arithmetic visible: they are NOT measured and NOT a promise. A pilot replaces them.
 */
export const DEFAULT_ASSUMPTIONS: Record<'google_ads' | 'meta_ads' | 'tiktok_ads', Pick<Assumption, 'cpm' | 'ctr'>> = {
  google_ads: { cpm: 8, ctr: 0.007 },
  meta_ads: { cpm: 10, ctr: 0.011 },
  tiktok_ads: { cpm: 7, ctr: 0.008 },
}
/** Example share of clicks that become the chosen result (a click itself for traffic; a view, subscriber, lead or sale otherwise). Editable. */
export const GOAL_CONVERSION: Record<Goal, number> = { awareness: 1, views: 0.35, subscribers: 0.03, traffic: 1, leads: 0.08, sales: 0.02, engagement: 0.1 }

/** Market price level: media costs in rich markets are usually higher. Three coarse tiers, editorial. */
export const COUNTRY_TIER: Record<string, 'alto' | 'medio'> = { US: 'alto', CH: 'alto', AU: 'alto', GB: 'alto', CA: 'alto', DE: 'alto', NO: 'alto', SE: 'alto', DK: 'alto', NL: 'alto', IE: 'alto', AT: 'alto', LU: 'alto', SG: 'alto', ES: 'medio', FR: 'medio', IT: 'medio', JP: 'medio', KR: 'medio', PT: 'medio', PL: 'medio' }
export const TIER_FACTOR = { alto: 1.3, medio: 1, bajo: 0.6 } as const
