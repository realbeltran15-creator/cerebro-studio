/**
 * Provider selection. Ranks the catalogue for a request and explains why; it never generates
 * anything. Even when a strategy picks a paid model the page still asks for confirmation with
 * the estimated cost, so an automatic choice can never spend money on its own.
 */
import type { Capability, CatalogModel, Format, GenerationOptions, Modality } from './catalog'
import type { CostTier } from './directory'

/** Browser storage key for the user's default strategy (set in Costes y créditos). */
export const STRATEGY_KEY = 'cerebro.defaultStrategy'

export type Strategy = 'free_first' | 'free_only' | 'cheapest' | 'best_quality' | 'fastest'

export const strategyLabels: Record<Strategy, string> = {
  free_first: 'Gratis y créditos primero',
  free_only: 'Solo opciones gratuitas',
  cheapest: 'La opción más barata',
  best_quality: 'Máxima calidad',
  fastest: 'La más rápida',
}

export type RouteRequest = {
  modality: Modality
  strategy: Strategy
  options?: GenerationOptions
  format?: Format
  durationSeconds?: number
  needs?: Capability[]
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
    if (req.providers?.length && !req.providers.includes(model.provider)) reasons.push('No es el proveedor elegido')
    if (options.format && model.formats && !model.formats.includes(options.format)) reasons.push(`No genera formato ${options.format}`)
    if (options.durationSeconds && model.durations && !model.durations.some(d => d >= options.durationSeconds!)) reasons.push(`No llega a ${options.durationSeconds} s`)
    for (const need of req.needs ?? []) if (!model.capabilities.includes(need)) reasons.push(`Sin capacidad: ${need}`)
    return { model, eligible: reasons.length === 0, reasons, estimateUsd: model.estimateUsd(options) }
  })
  const score = (r: Ranked) => {
    const m = r.model
    switch (req.strategy) {
      case 'free_first':
      case 'free_only': return [tierRank[m.tier], -m.quality, r.estimateUsd]
      case 'cheapest': return [r.estimateUsd, tierRank[m.tier], -m.quality]
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
