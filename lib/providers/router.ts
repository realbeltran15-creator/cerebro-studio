/**
 * Provider selection. Ranks the catalogue for a request and explains why; it never generates
 * anything. Even when a strategy picks a paid model the page still asks for confirmation with
 * the estimated cost, so an automatic choice can never spend money on its own.
 */
import { evidenceOf, rightsOf, type Capability, type CatalogModel, type Evidence, type Format, type GenerationOptions, type Modality } from './catalog'
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
  /** The output will be published commercially: models whose output is non-commercial are excluded, plan-dependent ones are flagged. */
  needsCommercial?: boolean
  /** Shortest side of the output in pixels (e.g. 1080 for 1080p, 1024 for a 1024² image). */
  minShortSidePx?: number
  /** Number of reference images the request attaches (identity / style). */
  references?: number
}

/**
 * Live facts about a model: configured on the server and, when known, whether credits remain.
 * `remaining` is in the unit of the model's free allowance (neurons, seconds, characters).
 */
export type Availability = { ready: boolean; creditsExhausted?: boolean; remaining?: number }

export type Ranked = {
  model: CatalogModel; eligible: boolean; reasons: string[]; estimateUsd: number
  /** Things to keep in mind even when the model is eligible (rights, evidence, price not confirmed). */
  warnings: string[]
  evidence: Evidence
  /** True when the only thing wrong is that the free allowance ran out (a free alternative may exist). */
  exhausted: boolean
}

const evidenceRank: Record<Evidence, number> = { tested: 0, documented: 1, secondary: 2, unverified: 3 }
const EXHAUSTED = 'Cupo gratuito agotado'

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
    const needUnits = model.allowanceUnits?.(options) ?? 0
    const outOfAllowance = Boolean(model.allowance) && a.remaining !== undefined && needUnits > 0 && a.remaining + 1e-9 < needUnits
    if (outOfAllowance) reasons.push(`${EXHAUSTED}: quedan ${Math.floor(a.remaining ?? 0)} ${model.allowance!.unit} y esta generación necesita ${Math.ceil(needUnits)}`)
    const evidence = evidenceOf(model)
    // A model implemented from documentation fragments is never picked by a strategy: only an explicit provider choice uses it.
    if (evidence === 'unverified' && !req.providers?.includes(model.provider)) reasons.push('Integración sin verificar: elígela como proveedor específico')
    if (req.needsCommercial && rightsOf(model) === 'non_commercial') reasons.push('Su salida no es de uso comercial')
    if (req.minShortSidePx && (model.maxShortSidePx ?? 0) < req.minShortSidePx) reasons.push(`Resolución máxima ${model.maxResolution ?? 'desconocida'}, por debajo de la necesaria`)
    if ((req.references ?? 0) > 0 && (model.references?.max ?? 0) < (req.references ?? 0)) reasons.push(model.references ? `Admite ${model.references.max} imágenes de referencia como máximo` : 'No admite imágenes de referencia')
    if (req.strategy === 'free_only' && !FREE_TIERS.includes(model.tier)) reasons.push('Es de pago')
    if (req.minQuality && model.quality < req.minQuality) reasons.push(`Calidad ${model.quality}/5, por debajo de la necesaria (${req.minQuality}/5)`)
    if (req.providers?.length && !req.providers.includes(model.provider)) reasons.push('No es el proveedor elegido')
    // Unpublished price (account credits): automatic strategies cannot compare its cost, so only an explicit choice uses it.
    if (model.confirm && !req.providers?.includes(model.provider)) reasons.push('Precio no publicado: elígelo como proveedor específico')
    if (options.format && model.formats && !model.formats.includes(options.format)) reasons.push(`No genera formato ${options.format}`)
    if (options.durationSeconds && model.durations && !model.durations.some(d => d >= options.durationSeconds!)) reasons.push(`No llega a ${options.durationSeconds} s`)
    for (const need of req.needs ?? []) if (!model.capabilities.includes(need)) reasons.push(`Sin capacidad: ${need}`)
    const warnings: string[] = []
    if (req.needsCommercial && rightsOf(model) === 'plan_dependent') warnings.push(model.rightsNote ?? 'El uso comercial depende de tu plan en el proveedor.')
    if (req.needsCommercial && rightsOf(model) === 'check_terms') warnings.push(model.rightsNote ?? 'Revisa las condiciones del proveedor para uso comercial.')
    if (evidence === 'secondary' || evidence === 'unverified') warnings.push(model.evidenceNote ?? (evidence === 'secondary' ? 'Solo hay fuentes de terceros sobre este modelo.' : 'Integración sin verificar con el proveedor real.'))
    if (!model.priceConfirmed && model.tier === 'paid') warnings.push('El precio no está confirmado: la factura del proveedor es la referencia.')
    // Exhausted = the only blocker is the allowance (so a free alternative is worth suggesting).
    const exhausted = reasons.length > 0 && reasons.every(r => r.startsWith(EXHAUSTED) || r.startsWith('Sin créditos'))
    return { model, eligible: reasons.length === 0, reasons, estimateUsd: model.estimateUsd(options), warnings, evidence, exhausted }
  })
  const score = (r: Ranked) => {
    const m = r.model
    // Last tiebreaker everywhere: prefer what was actually tested over what is only documented.
    const e = evidenceRank[r.evidence]
    switch (req.strategy) {
      case 'best_value': return [tierRank[m.tier], r.estimateUsd, -m.quality, e]
      case 'free_only': return [tierRank[m.tier], -m.quality, r.estimateUsd, e]
      case 'best_quality': return [-m.quality, e, r.estimateUsd]
      case 'fastest': return [speedRank[m.speed], -m.quality, e]
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

export type Recommendation = {
  /** The model that could not be used (exhausted, failed or unavailable). */
  from: string | null
  /** Free (or plan-credit) models that fit the same request, best first. These can be offered with one click. */
  free: Ranked[]
  /**
   * Paid models that fit the request. Informational ONLY: using one needs the user's explicit
   * authorization and the cost confirmation; this module never selects them.
   */
  paid: Ranked[]
  message: string
}

/**
 * What to suggest when a free provider has run out of credits (or refused the request).
 * It never switches anything by itself and never returns a paid model as the recommendation:
 * the free list is the recommendation, the paid list is shown as an option that needs authorization.
 */
export function recommendAlternatives(models: CatalogModel[], req: RouteRequest, availability: Record<string, Availability>, failedModelId: string | null): Recommendation {
  const open = { ...req, providers: undefined }
  const others = models.filter(m => m.id !== failedModelId)
  const free = rankModels(others, { ...open, strategy: 'free_only' }, availability).filter(r => r.eligible)
  const paid = rankModels(others, { ...open, strategy: 'best_value' }, availability).filter(r => r.eligible && !FREE_TIERS.includes(r.model.tier))
  const from = failedModelId ? models.find(m => m.id === failedModelId)?.label ?? failedModelId : null
  const message = free.length
    ? `${from ? `${from} no está disponible. ` : ''}Alternativa gratuita compatible: ${free[0].model.label}${free.length > 1 ? ` (y ${free.length - 1} más)` : ''}. No se cambia nada sin que lo elijas.`
    : `${from ? `${from} no está disponible. ` : ''}No queda ninguna alternativa gratuita compatible.${paid.length ? ` Hay ${paid.length} opción(es) de pago, que solo se usan con tu autorización y confirmando el coste.` : ''}`
  return { from, free, paid, message }
}
