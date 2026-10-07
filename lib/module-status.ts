/**
 * Single source of truth for how finished each module really is.
 * Update this file whenever a module changes state — the UI reads it
 * so a page that merely loads is never presented as a finished feature.
 */
export type ModuleState = 'functional' | 'partial' | 'integration_ready' | 'not_implemented'

export const moduleStateLabels: Record<ModuleState, string> = {
  functional: 'Funcional',
  partial: 'Parcial',
  integration_ready: 'Preparado para integración',
  not_implemented: 'No implementado',
}

export type StudioModule = {
  label: string
  short: string
  href: string
  icon: string
  state: ModuleState
  note: string
  /** Shown as a tool tile on the dashboard. */
  tile?: boolean
}

export const studioModules: StudioModule[] = [
  { label: 'Inicio', short: 'Inicio', href: '/', icon: 'home', state: 'functional', note: 'Centro de operaciones con datos reales del workspace.' },
  { label: 'Investigación', short: 'Investigación', href: '/market-intelligence', icon: 'search', state: 'functional', note: 'Búsqueda de vídeos y análisis de canales con YouTube Data API (mediana, frecuencia, vídeos destacados), métricas observadas y calculadas por separado, y registro manual con fuente. Requiere YOUTUBE_API_KEY.' },
  { label: 'Radar', short: 'Radar', href: '/radar', icon: 'radar', state: 'functional', note: 'Tendencias oficiales de YouTube por país y categoría con histórico: nuevos, subidas, bajadas y vistas ganadas entre lecturas, más términos recurrentes. Requiere YOUTUBE_API_KEY.' },
  { label: 'Oportunidades', short: 'Oportunidades', href: '/opportunities', icon: 'target', state: 'functional', note: 'Búsqueda, filtros, estados y conversión a proyecto; métricas observadas y calculadas por separado, orden por rendimiento, historial y actualización desde YouTube.' },
  { label: 'Proyectos', short: 'Proyectos', href: '/projects', icon: 'folder', state: 'functional', note: 'Cada proyecto conecta investigación, guion, storyboard, assets y publicación.' },
  { label: 'Guiones', short: 'Guion', href: '/scripts', icon: 'script', state: 'functional', note: 'Versiones, secciones con base factual, testimonios y conversión a storyboard. Asistencia IA revisable con el proveedor de texto que alcance la calidad necesaria (Groq, Gemini u OpenAI).', tile: true },
  { label: 'Estudio de creación', short: 'Estudio IA', href: '/studio', icon: 'layers', state: 'functional', note: 'Imagen, vídeo, voz, música, efectos y ambientes con varios proveedores (gratis, con créditos y de pago), elección manual o automática con regla «calidad primero»: mejor relación calidad-coste, gratis solamente, máxima calidad o más rápido, con calidad mínima configurable, vista previa, bancos gratuitos con licencia, vínculo a escenas y confirmación antes de cada generación. Cada proveedor se activa con su clave.', tile: true },
  { label: 'Storyboard y escenas', short: 'Storyboard', href: '/create', icon: 'board', state: 'functional', note: 'Escenas con prompts, cámara, sonido y continuidad entre escenas.', tile: true },
  { label: 'Música y sonidos', short: 'Música / SFX', href: '/audio', icon: 'music', state: 'functional', note: 'Generar música, efectos y ambientes en bucle con IA, buscar en Freesound con licencia CC, subir audio propio o licenciado; todo con proveedor, modelo, coste, licencia y escena registrados.', tile: true },
  { label: 'Editor de vídeo', short: 'Editor', href: '/editor', icon: 'scissors', state: 'functional', note: 'Modo automático por escenas (imagen o vídeo subido, de la Biblioteca o generado; voz; música con ducking; subtítulos) y Editor manual con timeline: reordenar, recortar, dividir, duplicar, duración, zoom/posición, textos, transiciones, pistas de voz/música/efectos, volumen y deshacer/rehacer. Render MP4 en el navegador (WebM en Firefox) guardado en la nube. «Aprende de mí»: graba cómo editas y repite tu estilo en otros montajes.', tile: true },
  { label: 'Montaje automático', short: 'Auto-edición', href: '/editor/auto', icon: 'scissors', state: 'functional', note: 'Edita solo un vídeo en bruto en el navegador, sin coste: quita silencios, corta en los cambios de plano, divide tomas largas, pone transiciones, música y subtítulos de la transcripción, y puede aplicar un estilo aprendido de ti («Aprende de mí» en el editor manual). Exporta MP4.', tile: true },
  { label: 'Shorts / Reels / TikTok', short: 'Convertir a Shorts', href: '/repurpose', icon: 'phone', state: 'functional', note: 'Recorta un montaje a 9:16: sugerencia calculada (no IA) del mejor tramo de escenas para Shorts, Reels o TikTok (gancho al inicio, frase completa al final, recursos visuales, duración), selección manual, reencuadre por escena, hook en pantalla, límites por plataforma y render. No publica. Propone también el hook en pantalla y un borrador de título y descripción (calculados, para revisar). Aún no analiza el audio ni la transcripción para elegir fragmentos.', tile: true },
  { label: 'Miniaturas', short: 'Miniaturas', href: '/thumbnails', icon: 'thumb', state: 'functional', note: 'Variantes 16:9 por proyecto con cualquier proveedor de imagen configurado: automático elige la calidad alta (y texto legible si hay texto) al menor coste, o eliges el modelo. Confirmación de coste, trabajos en cola y selección de la definitiva para YouTube.', tile: true },
  { label: 'YouTube', short: 'Publicar', href: '/youtube', icon: 'youtube', state: 'partial', note: 'Borradores con vídeo, miniatura, descripción y privacidad; aprobación explícita con resumen de riesgos y licencias; subida privada por defecto e idempotente. Requiere el cliente OAuth y el permiso de subida.', tile: true },
  { label: 'Instagram y TikTok', short: 'Redes', href: '/social', icon: 'phone', state: 'integration_ready', note: 'OAuth oficial (Instagram Business Login y TikTok Login Kit), borradores, aprobación explícita y publicación por API oficial: Reels (solo MP4) y TikTok privado por defecto. Se activa con las credenciales de cada app; TikTok solo publica en público tras la auditoría de la app.', tile: true },
  { label: 'Analytics', short: 'Analytics', href: '/analytics', icon: 'chart', state: 'partial', note: 'Importa YouTube Analytics de tu canal (7/28/90 días): serie diaria y vídeos principales, observado y calculado por separado, y un panel «Qué ha funcionado» (vídeos sobre 2× la mediana, mayor porcentaje visto, vistas por duración) calculado y descriptivo, no causal, con mínimo de 5 vídeos. Aún no alimenta automáticamente el siguiente guion ni las oportunidades. Requiere el cliente OAuth de Google.' },
  { label: 'Biblioteca', short: 'Biblioteca', href: '/library', icon: 'library', state: 'functional', note: 'Ficha de procedencia de cada archivo: proveedor, modelo, prompt, parámetros, coste/créditos, licencia, atribución, escena, fuente original y versiones derivadas. Transcripción a subtítulos (SRT/VTT) con Whisper (Groq o Cloudflare, gratis con límites).' },
  { label: 'Costes y créditos', short: 'Costes', href: '/usage', icon: 'chart', state: 'functional', note: 'Generaciones por proveedor y modelo, coste estimado y real, créditos gastados, saldo en vivo de ElevenLabs y estrategia por defecto (p. ej. gratis primero).' },
  { label: 'Conectores (APIs)', short: 'Conectores', href: '/connectors', icon: 'link', state: 'functional', note: 'Estado real de proveedores, directorio con nivel de coste, autenticación y límites comprobados, y explicación de Google Flow frente a sus APIs oficiales.' },
  { label: 'Automatizaciones', short: 'Automatizaciones', href: '/automations', icon: 'bolt', state: 'partial', note: 'Vigilancia de tendencias con palabras clave y actualización de métricas de oportunidades, con historial. Ejecución manual y diaria programada (07:00 UTC, Vercel Cron en producción) con historial de cada ejecución. Nunca publican ni gastan.' },
]

export function moduleFor(href: string) {
  return studioModules.find(m => m.href === href)
}
