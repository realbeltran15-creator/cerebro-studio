/**
 * Provider selection. Ranks the catalogue for a request and explains why; it never generates
 * anything. Even when a strategy picks a paid model the page still asks for confirmation with
 * the estimated cost, so an automatic choice can never spend money on its own.
 */
import type { Capability, CatalogModel, Format, GenerationOptions, Modality } from './catalog'
import type { CostTier } from './directory'

/** Browser storage key for the user's default strategy (set in Costes y créditos). */
export const STRATEGY_KEY = 'cerebro.defaultStrategy'

/**
 * Quality first: `best_value` keeps only models that reach the required quality and, among them,
 * prefers free allowance → plan credits/freemium → lowest price. A cheaper model that does not
 * reach the required quality is never chosen by it.
 */
export type Strategy = 'best_value' | 'free_only' | 'best_quality' | 'fastest'

export const strategyLabels: Record<Strategy, string> = {
  best_value: 'Mejor relación calidad-coste',
  free_only: 'Gratis solamente',
  best_quality: 'Máxima calidad',
  fastest: 'Más rápido',
}

export const qualityLevels = [
  { value: 2, label: 'Borrador (pruebas, bocetos)' },
  { value: 3, label: 'Estándar' },
  { value: 4, label: 'Alta (publicable)' },
  { value: 5, label: 'Máxima' },
] as const

/** Older saved values map onto the current strategies. */
export function normalizeStrategy(v: unknown): Strategy | 'manual' | null {
  if (v === 'manual') return 'manual'
  if (v === 'free_first' || v === 'cheapest') return 'best_value'
  return typeof v === 'string' && v in strategyLabels ? v as Strategy : null
}

export type RouteRequest = {
  modality: Modality
  strategy: Strategy
  options?: GenerationOptions
  format?: Format
  durationSeconds?: number
  needs?: Capability[]
  /** Required quality (1–5). Used by every strategy; best_value then minimises cost among the models that reach it. */
  minQuality?: number
  /** Only these providers (manual choice, e.g. "usar proveedor X"). */
  providers?: string[]
}

/** Live facts about a model: configured on the server and, when the provider reports it, whether credits remain. */
export type Availability = { ready: boolean; creditsExhausted?: boolean }

export type Ranked = { model: CatalogModel; eligible: boolean; reasons: string[]; estimateUsd: number }

const tierRank: Record<CostTier, number> = { free: 0, local: 0, credits: 1, freemium: 1, paid: 2 }
const speedRank = { fast: 0, medium: 1, slow: 2 } as const
const FREE_TIERS: CostTier[] = ['free', 'local', 'credits', 'freemium']

export function rankModels(models: CatalogModel[], req: RouteRequest, availability: Record<string, Availability>): Ranked[] {
  const options: GenerationOptions = { ...req.options, format: req.format ?? req.options?.format, durationSeconds: req.durationSeconds ?? req.options?.durationSeconds }
  const ranked = models.filter(m => m.modality === req.modality).map(model => {
    const reasons: string[] = []
    const a = availability[model.id] ?? { ready: false }
    if (!a.ready) reasons.push('Falta configurar la clave en el servidor')
    if (a.creditsExhausted) reasons.push('Sin créditos disponibles en el proveedor')
    if (req.strategy === 'free_only' && !FREE_TIERS.includes(model.tier)) reasons.push('Es de pago')
    if (req.minQuality && model.quality < req.minQuality) reasons.push(`Calidad ${model.quality}/5, por debajo de la necesaria (${req.minQuality}/5)`)
    if (req.providers?.length && !req.providers.includes(model.provider)) reasons.push('No es el proveedor elegido')
    if (options.format && model.formats && !model.formats.includes(options.format)) reasons.push(`No genera formato ${options.format}`)
    if (options.durationSeconds && model.durations && !model.durations.some(d => d >= options.durationSeconds!)) reasons.push(`No llega a ${options.durationSeconds} s`)
    for (const need of req.needs ?? []) if (!model.capabilities.includes(need)) reasons.push(`Sin capacidad: ${need}`)
    return { model, eligible: reasons.length === 0, reasons, estimateUsd: model.estimateUsd(options) }
  })
  const score = (r: Ranked) => {
    const m = r.model
    switch (req.strategy) {
      case 'best_value': return [tierRank[m.tier], r.estimateUsd, -m.quality]
      case 'free_only': return [tierRank[m.tier], -m.quality, r.estimateUsd]
      case 'best_quality': return [-m.quality, r.estimateUsd]
      case 'fastest': return [speedRank[m.speed], -m.quality]
    }
  }
  return ranked.sort((x, y) => {
    if (x.eligible !== y.eligible) return x.eligible ? -1 : 1
    const a = score(x), b = score(y)
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return 0
  })
}

/** The model a strategy would pick, or null when nothing eligible exists (the UI then explains why). */
export function pickModel(models: CatalogModel[], req: RouteRequest, availability: Record<string, Availability>) {
  const first = rankModels(models, req, availability)[0]
  return first?.eligible ? first : null
}
