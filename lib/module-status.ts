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
  { label: 'Investigación', short: 'Investigación', href: '/market-intelligence', icon: 'search', state: 'partial', note: 'Búsqueda en YouTube Data API con métricas observadas y calculadas por separado (requiere YOUTUBE_API_KEY) y registro manual con fuente.' },
  { label: 'Radar', short: 'Radar', href: '/radar', icon: 'radar', state: 'partial', note: 'Tendencias oficiales de YouTube por país y categoría, con términos recurrentes calculados. Requiere YOUTUBE_API_KEY; sin histórico todavía.' },
  { label: 'Oportunidades', short: 'Oportunidades', href: '/opportunities', icon: 'target', state: 'partial', note: 'Búsqueda, filtros, orden, estados y conversión a proyecto. Se alimenta desde Investigación (manual o YouTube Data API).' },
  { label: 'Proyectos', short: 'Proyectos', href: '/projects', icon: 'folder', state: 'functional', note: 'Cada proyecto conecta investigación, guion, storyboard, assets y publicación.' },
  { label: 'Guiones', short: 'Guion', href: '/scripts', icon: 'script', state: 'functional', note: 'Versiones, secciones con base factual, testimonios y conversión a storyboard. Asistencia IA revisable si OPENAI_TEXT_API_KEY u OPENAI_API_KEY está configurada.', tile: true },
  { label: 'Storyboard y escenas', short: 'Storyboard', href: '/create', icon: 'board', state: 'functional', note: 'Escenas con prompts, cámara, sonido y continuidad entre escenas.', tile: true },
  { label: 'Imágenes IA', short: 'Imágenes IA', href: '/images', icon: 'image', state: 'integration_ready', note: 'Genera si OPENAI_API_KEY está configurada en el servidor.', tile: true },
  { label: 'Vídeos IA', short: 'Vídeo IA', href: '/videos', icon: 'video', state: 'integration_ready', note: 'Prueba con fal.ai (FAL_KEY). Google Flow no tiene API pública oficial confirmada: no se integra hasta que exista.', tile: true },
  { label: 'Voces IA', short: 'Voces IA', href: '/voices', icon: 'mic', state: 'integration_ready', note: 'OpenAI TTS o endpoint HTTP. El adaptador de ElevenLabs está pendiente.', tile: true },
  { label: 'Música y sonidos', short: 'Música / SFX', href: '/audio', icon: 'music', state: 'functional', note: 'Sube música y efectos propios o con licencia, con la licencia registrada. Sin proveedor de música generativa.', tile: true },
  { label: 'Editor de vídeo', short: 'Editor', href: '/editor', icon: 'scissors', state: 'functional', note: 'Montaje por escenas (visual, voz, duración), música con ducking, subtítulos y render WebM en el navegador guardado en la Biblioteca.', tile: true },
  { label: 'Shorts / Reels / TikTok', short: 'Convertir a Shorts', href: '/repurpose', icon: 'phone', state: 'not_implemented', note: 'Depende del editor y del render.', tile: true },
  { label: 'Miniaturas', short: 'Miniaturas', href: '/thumbnails', icon: 'thumb', state: 'integration_ready', note: 'Variantes 16:9 por proyecto y selección de la definitiva. Genera si OPENAI_API_KEY está configurada.', tile: true },
  { label: 'YouTube', short: 'Publicar', href: '/youtube', icon: 'youtube', state: 'partial', note: 'Prepara publicaciones sin enviarlas. Publicar requiere OAuth y aprobación explícita.', tile: true },
  { label: 'Analytics', short: 'Analytics', href: '/analytics', icon: 'chart', state: 'partial', note: 'Muestra métricas guardadas. Falta importación desde YouTube Analytics (OAuth).' },
  { label: 'Biblioteca', short: 'Biblioteca', href: '/library', icon: 'library', state: 'functional', note: 'Assets privados por proyecto con enlaces temporales.' },
  { label: 'Conectores (APIs)', short: 'Conectores', href: '/connectors', icon: 'link', state: 'functional', note: 'Estado real de proveedores leído del servidor.' },
  { label: 'Automatizaciones', short: 'Automatizaciones', href: '/automations', icon: 'bolt', state: 'not_implemented', note: 'Pendiente.' },
]

export function moduleFor(href: string) {
  return studioModules.find(m => m.href === href)
}
