/**
 * Registry of the data sources Investigación can use. Adding a source = adding one entry here (and, when it is connected, a module that
 * implements it). Each entry says plainly what it gives, what it costs, what it needs from the owner, and whether it is connected NOW.
 * Only sources that give immediate value at no extra cost are connected; the rest are listed with the exact requirement and are NOT built.
 */
export type SourceStatus = 'conectada' | 'referencia_incluida' | 'requiere_acceso_del_propietario' | 'requiere_pago' | 'descartada'
export type DataSource = {
  id: string; name: string; kind: 'oficial' | 'estudio' | 'tercero'
  status: SourceStatus
  cost: 'gratis' | 'de pago' | 'gratis con acceso del propietario'
  /** What it adds to the research. */
  gives: string[]
  /** What it can NOT give (so nothing is presented as more than it is). */
  cannot: string[]
  /** Exactly what the owner would need to provide for it to be connected (empty when already connected). */
  needs: string[]
  docs: string
  note?: string
}

export const SOURCES_REGISTRY: DataSource[] = [
  {
    id: 'youtube_data_api', name: 'YouTube Data API v3', kind: 'oficial', status: 'conectada', cost: 'gratis',
    gives: ['Visualizaciones, fecha, duración y etiquetas de vídeos públicos', 'Suscriptores y visualizaciones totales de canales públicos', 'País declarado por el canal (opcional)', 'Listas oficiales de tendencias por país'],
    cannot: ['Ingresos o RPM de ningún canal', 'País de los espectadores de vídeos ajenos', 'Visualizaciones por periodo de vídeos ajenos', 'Volumen de búsquedas'],
    needs: [], docs: 'https://developers.google.com/youtube/v3',
    note: 'Cuota diaria compartida por todo el proyecto de Google Cloud: 10 000 unidades y un límite aparte de búsquedas.',
  },
  {
    id: 'rpm_studies', name: 'Estudios de RPM por nicho y país (AIR Media-Tech y guías de terceros)', kind: 'estudio', status: 'referencia_incluida', cost: 'gratis',
    gives: ['Rangos de RPM por nicho con fecha, método y confianza', 'Reducción de RPM para Shorts', 'Precio relativo de la publicidad por país'],
    cannot: ['El RPM real de un canal concreto', 'Ingresos no publicitarios'],
    needs: [], docs: 'https://air.io/en/air-data-findings/which-youtube-niche-makes-the-most-money-in-2026-ranked-by-real-rpm-and-cpm',
    note: 'Son tablas estáticas dentro de la aplicación (con fecha de consulta): hay que revisarlas de vez en cuando.',
  },
  {
    id: 'youtube_analytics', name: 'YouTube Analytics API (solo canales propios)', kind: 'oficial', status: 'requiere_acceso_del_propietario', cost: 'gratis con acceso del propietario',
    gives: ['Ingresos reales, RPM real, país de los espectadores, retención y CTR de TUS canales'],
    cannot: ['Nada de canales ajenos'],
    needs: ['Iniciar sesión con la cuenta de Google propietaria del canal y autorizar los permisos yt-analytics.readonly y yt-analytics-monetary.readonly', 'Crear un cliente OAuth en Google Cloud con la pantalla de consentimiento (puede requerir verificación de Google para uso público)'],
    docs: 'https://developers.google.com/youtube/analytics',
    note: 'Es la única forma de tener RPM VERIFICADO, y solo de canales que tú gestionas. No está construida: no aporta valor a la investigación de mercado de canales ajenos.',
  },
  {
    id: 'socialblade', name: 'Social Blade (Business API)', kind: 'tercero', status: 'requiere_pago', cost: 'de pago',
    gives: ['Estadísticas históricas de canales (suscriptores y visualizaciones por día) y sus propias estimaciones de ingresos'],
    cannot: ['Ingresos reales (sus cifras son estimaciones)', 'País de la audiencia'],
    needs: ['Cuenta de Social Blade con acceso a la Business API y créditos de pago (precio por crédito no publicado oficialmente: se ve en su panel de desarrollador)', 'Aceptar sus condiciones de uso y de reutilización de datos', 'Facilitar la clave en una variable de entorno del servidor (nunca en el código)'],
    docs: 'https://socialblade.com/business',
    note: 'No se hace scraping de su web (infringe sus condiciones). No se contrata sin tu autorización. Con el histórico podrían calcularse vistas por periodo de canales ajenos, hoy imposible solo con YouTube Data API.',
  },
  {
    id: 'google_trends', name: 'Google Trends', kind: 'oficial', status: 'descartada', cost: 'gratis',
    gives: ['Interés de búsqueda relativo por tema y país'],
    cannot: ['Volúmenes absolutos'],
    needs: [], docs: 'https://developers.google.com/search/apis/trends',
    note: 'Descartada por ahora: el acceso programático oficial es limitado y no aporta valor inmediato a lo pedido. Se reconsiderará si se concede acceso.',
  },
]

export const sourceById = (id: string) => SOURCES_REGISTRY.find(s => s.id === id) ?? null
export const connectedSources = () => SOURCES_REGISTRY.filter(s => s.status === 'conectada' || s.status === 'referencia_incluida')
export const STATUS_LABEL: Record<SourceStatus, string> = { conectada: 'Conectada', referencia_incluida: 'Incluida (tabla de referencia)', requiere_acceso_del_propietario: 'Pendiente: requiere tu acceso', requiere_pago: 'Pendiente: requiere pago', descartada: 'Descartada por ahora' }
