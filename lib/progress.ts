/** Derives a project's real production progress from stored data (never from a manual flag). */
export type ProgressInput = {
  opportunities: number
  scripts: number
  approvedScripts: number
  storyboards: number
  scenes: number
  assets: number
  renders: number
  publications: number
  metrics: number
}

export type StepState = 'done' | 'next' | 'pending'

export type ProgressStep = {
  key: string
  label: string
  detail: string
  href: (projectId: string) => string
  state: StepState
  /** Index in the 6-step overview: Idea, Guion, Medios, Editar, Publicar, Analizar. */
  overview: number
}

const definitions: Array<Omit<ProgressStep, 'state' | 'detail'> & { done: (p: ProgressInput) => boolean; detail: (p: ProgressInput) => string }> = [
  { key: 'research', label: 'Investigación', overview: 0, href: () => '/opportunities', done: p => p.opportunities > 0, detail: p => p.opportunities ? `${p.opportunities} oportunidad(es) vinculada(s)` : 'Sin oportunidad vinculada' },
  { key: 'script', label: 'Guion', overview: 1, href: id => `/scripts?project=${id}`, done: p => p.scripts > 0, detail: p => p.scripts ? `${p.scripts} versión(es)` : 'Sin guion' },
  { key: 'approval', label: 'Guion aprobado', overview: 1, href: id => `/scripts?project=${id}`, done: p => p.approvedScripts > 0, detail: p => p.approvedScripts ? 'Aprobado' : 'Pendiente de revisión' },
  { key: 'storyboard', label: 'Storyboard', overview: 2, href: id => `/create?project=${id}`, done: p => p.storyboards > 0 && p.scenes > 0, detail: p => p.storyboards ? `${p.scenes} escena(s)` : 'Sin storyboard' },
  { key: 'assets', label: 'Recursos', overview: 2, href: () => '/library', done: p => p.assets > 0, detail: p => p.assets ? `${p.assets} asset(s)` : 'Sin imágenes, vídeo ni voz' },
  { key: 'edit', label: 'Montaje', overview: 3, href: () => '/editor', done: p => p.renders > 0, detail: () => 'Editor no implementado' },
  { key: 'publish', label: 'Publicación', overview: 4, href: id => `/youtube?project=${id}`, done: p => p.publications > 0, detail: p => p.publications ? `${p.publications} preparada(s), sin publicar` : 'Nada preparado' },
  { key: 'results', label: 'Resultados', overview: 5, href: () => '/analytics', done: p => p.metrics > 0, detail: p => p.metrics ? `${p.metrics} registro(s) de métricas` : 'Sin métricas' },
]

export function projectProgress(input: ProgressInput): ProgressStep[] {
  let nextAssigned = false
  return definitions.map(d => {
    const done = d.done(input)
    let state: StepState = done ? 'done' : 'pending'
    // Research is optional: it never blocks the "next" marker.
    if (!done && !nextAssigned && d.key !== 'research') { state = 'next'; nextAssigned = true }
    return { key: d.key, label: d.label, overview: d.overview, href: d.href, detail: d.detail(input), state }
  })
}

/** Position of the first unfinished required step in the 6-step overview. */
export function overviewIndex(steps: ProgressStep[]) {
  const next = steps.find(s => s.state === 'next')
  return next ? next.overview : 5
}

// Must match projects_status_check in Supabase.
export const projectStatuses: Record<string, string> = {
  draft: 'Borrador',
  research: 'Investigación',
  production: 'Producción',
  review: 'Revisión',
  ready: 'Listo para publicar',
  published: 'Publicado',
  archived: 'Archivado',
}

export function projectStatusLabel(status: string) {
  return projectStatuses[status] ?? status
}
