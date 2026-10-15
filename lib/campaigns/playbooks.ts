import type { Brief, PlatformId, ProjectKind } from './types'

/**
 * Playbooks: what changes in a campaign when the project is a lo-fi channel, a Shorts channel, an online shop… All of it is EDITORIAL
 * guidance (how such projects are usually run), never a measured result, and the screen labels it so. Each playbook adjusts the platform
 * ranking, the content and creative plan, the audience, the calendar tasks, the KPIs, the warnings and the stop / optimise / expand rules.
 */
export type PlaybookRule = { kind: 'detener' | 'optimizar' | 'ampliar'; when: string; then: string; /** Only for campaigns with paid media. */ paid?: boolean }
export type Playbook = {
  id: ProjectKind; label: string; blurb: string
  boost: Partial<Record<PlatformId, number>>
  content: Array<{ platform: PlatformId; item: string; cadence: string }>
  creatives: Array<{ title: string; spec: string; platforms: PlatformId[]; studioHref: string; studioLabel: string }>
  segments: Array<{ name: string; description: string; requires: string }>
  prep: string[]; test: string[]
  kpis: string[]
  warnings: string[]
  rules: PlaybookRule[]
  /** Goals that usually make sense for this kind (the first is proposed when none is chosen). */
  goals: string[]
}

export const PLAYBOOKS: Record<ProjectKind, Playbook> = {
  lofi: {
    id: 'lofi', label: 'Canal lo-fi / música ambiente', blurb: 'Contenido de larga duración que se consume de fondo: crece por constancia, estética reconocible y descubrimiento en YouTube, no por anuncios.',
    boost: { youtube_organic: 4, tiktok_organic: 1, instagram_organic: 0, google_ads: -1, meta_ads: -2, tiktok_ads: -2 },
    content: [
      { platform: 'youtube_organic', item: 'Mixes de 1–3 horas con una escena visual coherente (estudio, lluvia, noche) y listas de reproducción por momento del día', cadence: '2–3 mixes por semana (orientativo)' },
      { platform: 'youtube_organic', item: 'Directos 24/7 o maratones de fin de semana para acumular tiempo de visualización', cadence: 'Uno permanente o semanal (orientativo)' },
      { platform: 'tiktok_organic', item: 'Clips de 15–30 s del mix (bucle visual + gancho de ambiente) que remiten al vídeo largo', cadence: '4–5 por semana (orientativo)' },
      { platform: 'instagram_organic', item: 'Reels de bucle visual y capturas de la escena', cadence: '3 por semana (orientativo)' },
    ],
    creatives: [
      { title: 'Escena visual en bucle (fondo del mix)', spec: 'Imagen o vídeo en bucle sin cortes bruscos; misma identidad visual en todos los mixes.', platforms: ['youtube_organic', 'tiktok_organic', 'instagram_organic'], studioHref: '/studio', studioLabel: 'Generar escena en el Estudio' },
      { title: 'Pista musical con licencia registrada', spec: 'Música propia o con licencia comprobada; cada pista con su procedencia en la Biblioteca.', platforms: ['youtube_organic'], studioHref: '/audio', studioLabel: 'Música y sonidos' },
      { title: 'Miniatura reconocible de serie', spec: 'Plantilla fija (paleta, tipografía, composición) con variante A/B del título.', platforms: ['youtube_organic'], studioHref: '/thumbnails', studioLabel: 'Crear miniaturas' },
    ],
    segments: [{ name: 'Estudio y trabajo concentrado', description: 'Estudiantes y personas que trabajan en remoto y buscan música de fondo para concentrarse o relajarse.', requires: 'Palabras clave «música para estudiar / concentrarse / dormir» (pestaña Palabras clave de Investigación).' }],
    prep: ['Comprobar los derechos de cada pista (propia o con licencia) y guardar su procedencia: una reclamación de derechos frena un mix entero.', 'Definir la identidad visual de serie (paleta, escena, tipografía).'],
    test: ['Publicar 2–3 mixes de duración y escena distintas y comparar tiempo de visualización y porcentaje visto.'],
    kpis: ['Tiempo de visualización total', 'Porcentaje visto medio', 'Espectadores recurrentes', 'Suscriptores por mix'],
    warnings: ['Cada pista debe tener licencia o ser propia: un contenido de música ambiente sin derechos claros arriesga reclamaciones y la monetización.', 'Los anuncios de pago rara vez compensan en este formato: el crecimiento viene de constancia, listas de reproducción y SEO.'],
    rules: [
      { kind: 'detener', when: 'tres mixes seguidos tienen un porcentaje visto medio inferior a la mitad del de tu mejor mix', then: 'Para ese formato o esa escena y vuelve a la que mejor retuvo.' },
      { kind: 'optimizar', when: 'un mix tiene buen porcentaje visto pero pocas impresiones', then: 'Cambia la miniatura y el título (A/B) y añádelo a una lista de reproducción por momento del día.' },
      { kind: 'ampliar', when: 'dos mixes superan en tiempo de visualización a tu mediana', then: 'Publica más de ese estilo en serie y lanza un directo 24/7 con esa escena.' },
    ],
    goals: ['views', 'subscribers'],
  },
  shorts: {
    id: 'shorts', label: 'Canal de Shorts / vídeo vertical', blurb: 'Volumen y ritmo: series con un formato fijo, gancho en el primer segundo y un camino hacia el contenido largo.',
    boost: { tiktok_organic: 3, youtube_organic: 3, instagram_organic: 2, tiktok_ads: 1, meta_ads: 0, google_ads: -1 },
    content: [
      { platform: 'youtube_organic', item: 'Serie de Shorts con un formato repetible (misma estructura, tema distinto) y enlace al vídeo largo relacionado', cadence: 'Uno al día (orientativo)' },
      { platform: 'tiktok_organic', item: 'Los mismos vídeos adaptados (texto y gancho propios de la plataforma)', cadence: '1–2 al día (orientativo)' },
      { platform: 'instagram_organic', item: 'Reels de la serie con subtítulos', cadence: '4–5 por semana (orientativo)' },
    ],
    creatives: [
      { title: 'Plantilla de serie vertical 9:16', spec: 'Estructura fija: gancho (1–2 s), desarrollo, cierre que invita a ver el siguiente; subtítulos siempre.', platforms: ['youtube_organic', 'tiktok_organic', 'instagram_organic'], studioHref: '/shorts', studioLabel: 'Fábrica de Shorts' },
      { title: 'Versión vertical de un montaje largo', spec: 'Recorte del mejor tramo con el gancho al inicio.', platforms: ['youtube_organic', 'tiktok_organic', 'instagram_organic'], studioHref: '/repurpose', studioLabel: 'Convertir a vertical' },
    ],
    segments: [{ name: 'Descubrimiento en feed', description: 'Quien llega por el feed de vídeo corto sin buscar: el gancho decide casi todo.', requires: 'Solo el contenido; no hay segmentación fina en orgánico.' }],
    prep: ['Fijar el formato de la serie y su gancho; preparar 7–10 vídeos antes de publicar el primero para mantener el ritmo.'],
    test: ['Probar 3 ganchos distintos con el mismo contenido y comparar visualizaciones frente a «deslizados» (porcentaje que sigue viendo).'],
    kpis: ['Visualizaciones', 'Porcentaje que sigue viendo tras el gancho', 'Suscriptores por Short', 'Clics al vídeo largo'],
    warnings: ['Un Short suele rendir mucho menos por visualización que un vídeo largo: úsalos para atraer público hacia el contenido largo, no como única fuente de ingresos.', 'La constancia manda: sin un ritmo sostenido la serie no se puede evaluar.'],
    rules: [
      { kind: 'detener', when: 'una serie lleva 10 Shorts y todos quedan por debajo de tu mediana de visualizaciones', then: 'Retira esa serie y prueba otro formato.' },
      { kind: 'optimizar', when: 'los vídeos tienen visualizaciones pero se abandonan en los primeros segundos', then: 'Reescribe el gancho (primera frase y primer plano) antes de cambiar el tema.' },
      { kind: 'ampliar', when: 'una serie supera tu mediana en tres vídeos seguidos', then: 'Publica más de ese formato, adáptalo a las otras plataformas y enlaza un vídeo largo.' },
    ],
    goals: ['views', 'subscribers'],
  },
  canal_largo: {
    id: 'canal_largo', label: 'Canal de vídeos largos (educativo, documental, comentario)', blurb: 'Se gana con buen título y miniatura, retención y series; los anuncios de vídeo pueden acelerar un vídeo que ya funciona.',
    boost: { youtube_organic: 4, google_ads: 2, instagram_organic: 0, tiktok_organic: 1, meta_ads: 0, tiktok_ads: 0 },
    content: [
      { platform: 'youtube_organic', item: 'Vídeo largo con promesa clara en título y miniatura, y una serie que enlaza los vídeos entre sí', cadence: '1 por semana (orientativo)' },
      { platform: 'youtube_organic', item: 'Shorts que adelantan una idea del vídeo largo', cadence: '3 por semana (orientativo)' },
    ],
    creatives: [
      { title: 'Guion con gancho y estructura de retención', spec: 'Promesa en 30 s, giros cada pocos minutos, cierre que lleva al siguiente vídeo.', platforms: ['youtube_organic', 'google_ads'], studioHref: '/scripts', studioLabel: 'Abrir Guiones' },
      { title: 'Miniatura y título A/B', spec: 'Dos miniaturas 16:9 con el mismo mensaje, distinta composición.', platforms: ['youtube_organic', 'google_ads'], studioHref: '/thumbnails', studioLabel: 'Crear miniaturas' },
    ],
    segments: [{ name: 'Búsqueda y recomendados', description: 'Personas que buscan el tema o llegan por vídeos relacionados.', requires: 'Palabras clave y preguntas del análisis de Investigación.' }],
    prep: ['Elegir el tema con datos de Investigación (demanda, competencia, formato) antes de producir.'],
    test: ['Probar 2 títulos y miniaturas en el mismo vídeo y quedarse con el de mayor CTR de impresiones.'],
    kpis: ['CTR de impresiones', 'Porcentaje visto medio', 'Espectadores recurrentes', 'Suscriptores por vídeo'],
    warnings: ['Impulsar con anuncios un vídeo que aún no retiene bien solo paga por visitas que se van: prueba primero en orgánico.'],
    rules: [
      { kind: 'detener', when: 'un vídeo promocionado gasta la mitad del presupuesto de prueba con un porcentaje visto muy inferior al orgánico', then: 'Detén el anuncio y mejora el vídeo.', paid: true },
      { kind: 'optimizar', when: 'el CTR de impresiones es bajo pero el porcentaje visto es bueno', then: 'Cambia la miniatura y el título; el contenido ya funciona.' },
      { kind: 'ampliar', when: 'un vídeo supera tu mediana en CTR y retención', then: 'Hazle una continuación en serie y, si hay presupuesto, promociónalo.' },
    ],
    goals: ['views', 'subscribers'],
  },
  ecommerce: {
    id: 'ecommerce', label: 'Tienda online / producto físico', blurb: 'Se decide por el coste por compra frente al margen: sin seguimiento de conversiones y sin cuentas claras, el gasto no se puede optimizar.',
    boost: { meta_ads: 3, tiktok_ads: 2, google_ads: 2, instagram_organic: 2, tiktok_organic: 2, youtube_organic: 0 },
    content: [
      { platform: 'instagram_organic', item: 'Reels de producto en uso, antes/después y reseñas de clientes', cadence: '3–4 por semana (orientativo)' },
      { platform: 'tiktok_organic', item: 'Vídeos de producto con demostración y oferta; se pueden impulsar después con Spark Ads', cadence: '4–5 por semana (orientativo)' },
      { platform: 'meta_ads', item: 'Anuncios de producto: vídeo corto + imagen de catálogo, 3 variantes de gancho y 2 ofertas', cadence: 'Desde el primer día; se retiran las peores en la optimización' },
      { platform: 'google_ads', item: 'Anuncios de búsqueda por nombre de producto y de categoría (y catálogo si hay feed)', cadence: 'Desde el primer día' },
    ],
    creatives: [
      { title: 'Vídeo de producto en uso (UGC o demostración)', spec: 'Vertical 9:16, el producto visible en los 3 primeros segundos, oferta clara y llamada a la acción.', platforms: ['meta_ads', 'tiktok_ads', 'instagram_organic', 'tiktok_organic'], studioHref: '/studio', studioLabel: 'Crear en el Estudio' },
      { title: 'Imágenes de catálogo y banners', spec: 'Fondo limpio, precio y oferta legibles en móvil.', platforms: ['meta_ads', 'google_ads'], studioHref: '/studio', studioLabel: 'Crear en el Estudio' },
    ],
    segments: [
      { name: 'Compradores de intención alta', description: 'Quien busca el producto o la categoría (búsqueda) o interactuó con la tienda.', requires: 'Cuenta de Google Ads / píxel instalado.' },
      { name: 'Reorientación de carritos y visitas', description: 'Visitantes que no compraron: mensaje con prueba social u oferta.', requires: 'Píxel o API de conversiones con volumen suficiente; no existe el primer día.' },
    ],
    prep: ['Instalar el seguimiento de conversiones (píxel o API de conversiones) y comprobar que registra una compra de prueba.', 'Calcular el margen por pedido: es el tope del coste por compra.'],
    test: ['Probar 3 vídeos × 2 ofertas con presupuesto igual; juzgar por coste por compra frente al margen, no por clics.'],
    kpis: ['Compras', 'Coste por compra', 'ROAS', 'Valor medio del pedido'],
    warnings: ['Define el margen por pedido antes de gastar: si el coste por compra supera ese margen, cada venta pierde dinero.', 'Sin seguimiento de conversiones las plataformas no pueden optimizar las ventas.'],
    rules: [
      { kind: 'detener', when: 'el coste por compra supera el margen por pedido tras 50 clics o más', then: 'Pausa ese anuncio: cada venta perdería dinero.', paid: true },
      { kind: 'optimizar', when: 'hay clics y visitas pero pocas compras', then: 'Revisa ficha de producto, precio, gastos de envío y velocidad de carga antes de tocar el anuncio.' },
      { kind: 'ampliar', when: 'el ROAS supera el punto de equilibrio durante 3 días seguidos', then: 'Sube el presupuesto un 20 % cada 3 días y duplica el anuncio ganador en un público similar.', paid: true },
    ],
    goals: ['sales', 'traffic'],
  },
  digital: {
    id: 'digital', label: 'Producto digital / curso / plantillas', blurb: 'Se vende confianza: contenido útil gratuito, un imán de captación y una secuencia hasta la compra.',
    boost: { youtube_organic: 3, instagram_organic: 2, meta_ads: 2, google_ads: 1, tiktok_organic: 1, tiktok_ads: 0 },
    content: [
      { platform: 'youtube_organic', item: 'Vídeos que resuelven un problema concreto y terminan con el producto como siguiente paso', cadence: '1 por semana (orientativo)' },
      { platform: 'instagram_organic', item: 'Carruseles y Reels con un consejo accionable y llamada al imán de captación', cadence: '3 por semana (orientativo)' },
      { platform: 'meta_ads', item: 'Anuncio del imán de captación (guía gratuita) para formar la lista antes de vender', cadence: 'Desde el primer día' },
    ],
    creatives: [
      { title: 'Imán de captación (guía, plantilla o miniclase gratuita)', spec: 'Una promesa concreta y entregable en minutos.', platforms: ['meta_ads', 'youtube_organic', 'instagram_organic'], studioHref: '/scripts', studioLabel: 'Abrir Guiones' },
    ],
    segments: [{ name: 'Personas con el problema', description: 'Quien busca resolver el problema que el producto soluciona.', requires: 'Palabras clave y preguntas de Investigación.' }],
    prep: ['Preparar el imán de captación, la página de destino y el registro de correos (con consentimiento).'],
    test: ['Probar 2 promesas distintas del imán y quedarse con la que más contactos consigue por unidad gastada.'],
    kpis: ['Contactos', 'Coste por contacto', 'Tasa de compra de la lista', 'Ingresos por contacto'],
    warnings: ['Recoge correos solo con consentimiento y cumple la normativa de protección de datos de cada país.'],
    rules: [
      { kind: 'detener', when: 'el coste por contacto supera 2 veces el objetivo tras 50 clics', then: 'Cambia la promesa del imán antes de gastar más.', paid: true },
      { kind: 'optimizar', when: 'entran contactos pero casi nadie compra', then: 'Mejora la secuencia de correos y la oferta, no el anuncio.' },
      { kind: 'ampliar', when: 'el ingreso por contacto supera el coste por contacto durante 2 semanas', then: 'Amplía presupuesto y prueba un segundo mercado.', paid: true },
    ],
    goals: ['leads', 'sales'],
  },
  otro: {
    id: 'otro', label: 'Otro tipo de proyecto', blurb: 'Plan general: elige un objetivo, prueba pocas variantes y decide con datos.',
    boost: {}, content: [], creatives: [], segments: [], prep: [], test: [], kpis: [], warnings: [], rules: [], goals: [],
  },
}

const SIGNALS: Array<[ProjectKind, RegExp]> = [
  ['lofi', /\b(lo-?fi|lofi|chill(hop)?|ambient|ambiente|relajante|study music|m[uú]sica para (estudiar|dormir|concentrar)|beats to)\b/i],
  ['shorts', /\b(shorts?|reels?|tiktoks?|vertical|v[ií]deos? cortos?)\b/i],
  ['ecommerce', /\b(tienda|shop|store|ecommerce|e-commerce|shopify|etsy|amazon|producto f[ií]sico|dropshipping)\b/i],
  ['digital', /\b(curso|course|plantillas?|templates?|ebook|gu[ií]a digital|membres[ií]a|newsletter|infoproducto)\b/i],
  ['canal_largo', /\b(documental|documentary|educativ|explicad|historia|curiosidades|an[aá]lisis|ensayo|tutorial)\b/i],
]

/** The kind chosen by the user, or inferred from the subject type and the words of its name / topic. Inference is a suggestion the user can override. */
export function kindOf(b: Pick<Brief, 'kind' | 'subject' | 'subjectName' | 'sourceTopic' | 'name'>): { kind: ProjectKind; inferred: boolean } {
  if (b.kind) return { kind: b.kind, inferred: false }
  const text = `${b.subjectName} ${b.sourceTopic} ${b.name}`
  for (const [kind, re] of SIGNALS) if (re.test(text)) return { kind, inferred: true }
  if (b.subject === 'store' || b.subject === 'product') return { kind: 'ecommerce', inferred: true }
  return { kind: 'otro', inferred: true }
}
