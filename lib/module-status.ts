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
  { label: 'Investigación', short: 'Investigación', href: '/market-intelligence', icon: 'search', state: 'partial', note: 'Registro manual de hallazgos con fuente. Falta búsqueda automática con YouTube Data API (requiere API key).' },
  { label: 'Radar', short: 'Radar', href: '/radar', icon: 'radar', state: 'not_implemented', note: 'Sin fuente de tendencias conectada todavía.' },
  { label: 'Oportunidades', short: 'Oportunidades', href: '/opportunities', icon: 'target', state: 'partial', note: 'Búsqueda, filtros, orden, estados y conversión a proyecto. Falta ingesta automática.' },
  { label: 'Proyectos', short: 'Proyectos', href: '/projects', icon: 'folder', state: 'functional', note: 'Cada proyecto conecta investigación, guion, storyboard, assets y publicación.' },
  { label: 'Guiones', short: 'Guion', href: '/scripts', icon: 'script', state: 'functional', note: 'Versiones, secciones con base factual, testimonios y conversión a storyboard. La asistencia IA espera un proveedor de texto.', tile: true },
  { label: 'Storyboard y escenas', short: 'Storyboard', href: '/create', icon: 'board', state: 'functional', note: 'Escenas con prompts, cámara, sonido y continuidad entre escenas.', tile: true },
  { label: 'Imágenes IA', short: 'Imágenes IA', href: '/images', icon: 'image', state: 'integration_ready', note: 'Genera si OPENAI_API_KEY está configurada en el servidor.', tile: true },
  { label: 'Vídeos IA', short: 'Vídeo IA', href: '/videos', icon: 'video', state: 'integration_ready', note: 'Prueba con fal.ai (FAL_KEY). Google Flow no tiene API pública oficial confirmada: no se integra hasta que exista.', tile: true },
  { label: 'Voces IA', short: 'Voces IA', href: '/voices', icon: 'mic', state: 'integration_ready', note: 'OpenAI TTS o endpoint HTTP. El adaptador de ElevenLabs está pendiente.', tile: true },
  { label: 'Música y sonidos', short: 'Música / SFX', href: '/audio', icon: 'music', state: 'not_implemented', note: 'Sin proveedor conectado.', tile: true },
  { label: 'Editor de vídeo', short: 'Editor', href: '/editor', icon: 'scissors', state: 'not_implemented', note: 'Requiere un worker de render (FFmpeg).', tile: true },
  { label: 'Shorts / Reels / TikTok', short: 'Convertir a Shorts', href: '/repurpose', icon: 'phone', state: 'not_implemented', note: 'Depende del editor y del render.', tile: true },
  { label: 'Miniaturas', short: 'Miniaturas', href: '/thumbnails', icon: 'thumb', state: 'not_implemented', note: 'Pendiente.' },
  { label: 'YouTube', short: 'Publicar', href: '/youtube', icon: 'youtube', state: 'partial', note: 'Prepara publicaciones sin enviarlas. Publicar requiere OAuth y aprobación explícita.', tile: true },
  { label: 'Analytics', short: 'Analytics', href: '/analytics', icon: 'chart', state: 'partial', note: 'Muestra métricas guardadas. Falta importación desde YouTube Analytics (OAuth).' },
  { label: 'Biblioteca', short: 'Biblioteca', href: '/library', icon: 'library', state: 'functional', note: 'Assets privados por proyecto con enlaces temporales.' },
  { label: 'Conectores (APIs)', short: 'Conectores', href: '/connectors', icon: 'link', state: 'functional', note: 'Estado real de proveedores leído del servidor.' },
  { label: 'Automatizaciones', short: 'Automatizaciones', href: '/automations', icon: 'bolt', state: 'not_implemented', note: 'Pendiente.' },
]

export function moduleFor(href: string) {
  return studioModules.find(m => m.href === href)
}
