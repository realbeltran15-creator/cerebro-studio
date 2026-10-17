import type { PlatformId } from './types'

/**
 * Architecture for the official advertising APIs. NOTHING here talks to an ad platform: campaigns are designed and saved without any
 * connection, and each capability stays "no disponible" until (1) the platform approved the app, (2) the user authorised an ad account
 * and (3) the adapter below is implemented and tested. `adapters` is deliberately empty.
 */
export type AdNetwork = 'google_ads' | 'meta_ads' | 'tiktok_ads'
export type Capability = 'read_accounts' | 'create_campaign_draft' | 'publish_campaign' | 'read_reports' | 'pause_campaign'

export interface AdPlatformAdapter {
  readonly network: AdNetwork
  listAccounts(): Promise<Array<{ id: string; name: string; currency: string }>>
  /** Creates the campaign PAUSED/draft; activating it is a separate, explicitly approved step. */
  createCampaignDraft(input: { accountId: string; campaignId: string }): Promise<{ externalId: string }>
  readReport(input: { accountId: string; externalId: string; from: string; to: string }): Promise<unknown>
  pause(input: { accountId: string; externalId: string }): Promise<void>
}
export const adapters: Partial<Record<AdNetwork, AdPlatformAdapter>> = {}

export type Requirement = { step: string; detail: string; who: 'tú' | 'plataforma' | 'desarrollo' }
export type NetworkInfo = {
  network: AdNetwork; label: string; api: string; docs: string; auth: string; scopes: string[]
  requirements: Requirement[]; approvalTime: string; envNames: string[]; notes: string[]
}

export const NETWORKS: NetworkInfo[] = [
  { network: 'google_ads', label: 'Google Ads', api: 'Google Ads API', docs: 'https://developers.google.com/google-ads/api/docs/access-levels', auth: 'OAuth 2.0 + token de desarrollador', scopes: ['https://www.googleapis.com/auth/adwords'],
    requirements: [
      { step: 'Cuenta de administrador (MCC) de Google Ads', detail: 'El token de desarrollador se solicita en el Centro de API de la cuenta de administrador.', who: 'tú' },
      { step: 'Token de desarrollador', detail: 'Empieza con acceso de prueba (solo cuentas de prueba). Para cuentas reales hay que solicitar acceso Básico; el Estándar es para herramientas que atienden a muchos usuarios.', who: 'plataforma' },
      { step: 'Cliente OAuth en Google Cloud', detail: 'Pantalla de consentimiento y el ámbito adwords; el usuario autoriza su cuenta publicitaria.', who: 'desarrollo' },
      { step: 'Cuenta publicitaria con facturación', detail: 'La crea y paga la persona; la app nunca introduce datos de pago.', who: 'tú' },
    ], approvalTime: 'Acceso Básico: unos 5 días laborables según la documentación de Google; Estándar: unos 10 (puede pedir más información).', envNames: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'],
    notes: ['El acceso Básico limita las operaciones diarias (15.000 según la documentación).', 'Los usos permitidos (crear anuncios, informes, palabras clave) dependen del uso declarado en la solicitud.'] },
  { network: 'meta_ads', label: 'Meta Ads (Instagram y Facebook)', api: 'Marketing API', docs: 'https://developers.facebook.com/docs/marketing-api/get-started/authorization', auth: 'OAuth 2.0 de Meta (app de Meta)', scopes: ['ads_management', 'ads_read', 'business_management (si se gestionan activos de un negocio)'],
    requirements: [
      { step: 'App de Meta for Developers y Business Manager', detail: 'La app necesita el producto Marketing API y estar vinculada al negocio.', who: 'desarrollo' },
      { step: 'Acceso a los permisos', detail: 'Con acceso estándar solo se gestionan cuentas publicitarias propias o con rol en la app. Para cuentas de terceros hace falta acceso avanzado: revisión de la app y verificación del negocio. Meta ha renombrado los niveles (estándar → limitado, avanzado → completo); comprueba los nombres vigentes.', who: 'plataforma' },
      { step: 'Cuenta publicitaria con método de pago y página vinculada', detail: 'Para Instagram, la cuenta profesional vinculada a la página.', who: 'tú' },
      { step: 'Autorización del usuario', detail: 'El usuario inicia sesión con Meta y concede los permisos; la app guarda el token cifrado.', who: 'tú' },
    ], approvalTime: 'La verificación del negocio y la revisión de la app pueden tardar de días a semanas; Meta no da un plazo garantizado.', envNames: ['META_APP_ID', 'META_APP_SECRET'],
    notes: ['Los umbrales de uso para subir de nivel han cambiado; consulta la documentación «Marketing API access tiers».', 'Las campañas se crean en pausa y se activan con una acción aparte.'] },
  { network: 'tiktok_ads', label: 'TikTok Ads', api: 'TikTok Marketing API (TikTok for Business)', docs: 'https://business-api.tiktok.com/portal/docs', auth: 'OAuth 2.0 del anunciante', scopes: ['Gestión de cuentas publicitarias', 'Gestión de anuncios', 'Informes (los nombres exactos los muestra el portal al crear la app)'],
    requirements: [
      { step: 'App en el portal de desarrolladores de TikTok for Business', detail: 'Solicita el producto Marketing API y los permisos de gestión y de informes.', who: 'desarrollo' },
      { step: 'Aprobación de la app', detail: 'Hasta que se aprueba, las cuentas publicitarias reales no pueden autorizarla (existe un entorno sandbox de pruebas).', who: 'plataforma' },
      { step: 'Cuenta de anunciante con facturación', detail: 'La crea y paga la persona.', who: 'tú' },
      { step: 'Autorización del anunciante', detail: 'El anunciante aprueba los permisos en la página de TikTok y la app guarda el token cifrado.', who: 'tú' },
    ], approvalTime: 'Las fuentes consultadas dan plazos distintos (de pocos días a semanas); no hay un plazo oficial garantizado.', envNames: ['TIKTOK_ADS_APP_ID', 'TIKTOK_ADS_APP_SECRET'],
    notes: ['No confundir con la Content Posting API (publicar vídeos orgánicos), que ya usa el módulo Redes con su propia aprobación.'] },
]
export const networkOf = (p: PlatformId): AdNetwork | null => p === 'google_ads' || p === 'meta_ads' || p === 'tiktok_ads' ? p : null

export type Readiness = { network: AdNetwork; credentialsPresent: boolean; adapterImplemented: boolean; state: 'no_disponible' | 'credenciales_sin_conexion'; message: string }
/** `env` only says WHETHER the names exist; values are never read into the result. */
export function readiness(env: Record<string, string | undefined>): Readiness[] {
  return NETWORKS.map(n => {
    const present = n.envNames.every(k => !!env[k]), implemented = !!adapters[n.network]
    return { network: n.network, credentialsPresent: present, adapterImplemented: implemented, state: present ? 'credenciales_sin_conexion' : 'no_disponible',
      message: implemented ? 'Conexión disponible.' : present ? 'Las credenciales de la app existen, pero la conexión con la API aún no está implementada: no se pueden crear ni publicar anuncios desde aquí.' : 'No disponible: faltan la aprobación de la plataforma y la conexión. Puedes diseñar y guardar la campaña igualmente.' }
  })
}
export const isPublishAvailable = (n: AdNetwork) => !!adapters[n]
