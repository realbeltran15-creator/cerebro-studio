/**
 * Usage and cost summary computed from asset provenance (every generated or imported asset
 * records provider, model, cost tier, estimate, reported cost and credits). Pure: easy to test.
 */
export type UsageAsset = {
  id: string; asset_type: string; project_id: string | null; source_provider: string | null
  license_status: string; provenance: Record<string, unknown> | null; created_at: string
}

export type UsageRow = { key: string; provider: string; model: string; kind: string; tier: string; count: number; estimatedUsd: number; reportedUsd: number | null; credits: number }
export type UsageEntry = { id: string; date: string; projectId: string | null; kind: string; provider: string; model: string; tier: string; estimatedUsd: number; credits: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Uploads made by the user are not generations and are left out. */
export function isGeneration(a: UsageAsset) {
  const p = a.provenance ?? {}
  return a.license_status === 'generated' || typeof p.catalogModel === 'string' || typeof p.importedAt === 'string' || typeof p.requestId === 'string'
}

export function entryOf(a: UsageAsset): UsageEntry {
  const p = a.provenance ?? {}
  const provider = String(p.providerName ?? p.provider ?? a.source_provider ?? 'desconocido')
  const model = String(p.catalogModel ?? p.model ?? '')
  const imported = typeof p.importedAt === 'string'
  const tier = String(p.costTier ?? (imported ? 'free' : 'paid')).replace('free_allowance', 'free')
  const credits = p.credits && typeof p.credits === 'object' ? num((p.credits as Record<string, unknown>).credits) : null
  return {
    id: a.id, date: a.created_at, projectId: a.project_id, kind: a.asset_type, provider, model,
    tier: ['free', 'local', 'credits', 'freemium', 'paid'].includes(tier) ? tier : 'paid',
    estimatedUsd: tier === 'paid' ? num(p.estimateUsd) ?? 0 : 0, credits,
  }
}

export function summarizeUsage(assets: UsageAsset[]) {
  const generated = assets.filter(isGeneration)
  const entries = generated.map(entryOf)
  const rows = new Map<string, UsageRow>()
  let reportedTotal: number | null = null
  for (const [i, e] of entries.entries()) {
    const p = generated[i].provenance ?? {}
    const cost = p.cost && typeof p.cost === 'object' ? p.cost as Record<string, unknown> : null
    const reported = cost?.reported === true ? num(cost.amount) : null
    const key = `${e.provider}|${e.model}|${e.kind}`
    const row = rows.get(key) ?? { key, provider: e.provider, model: e.model, kind: e.kind, tier: e.tier, count: 0, estimatedUsd: 0, reportedUsd: null, credits: 0 }
    row.count++
    row.estimatedUsd += e.estimatedUsd
    row.credits += e.credits ?? 0
    if (reported !== null) { row.reportedUsd = (row.reportedUsd ?? 0) + reported; reportedTotal = (reportedTotal ?? 0) + reported }
    rows.set(key, row)
  }
  const byTier = { free: 0, local: 0, credits: 0, freemium: 0, paid: 0 } as Record<string, number>
  for (const e of entries) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1
  return {
    generations: entries.length,
    estimatedUsd: entries.reduce((t, e) => t + e.estimatedUsd, 0),
    reportedUsd: reportedTotal,
    elevenCredits: entries.reduce((t, e) => t + (e.credits ?? 0), 0),
    byTier: byTier as Record<'free' | 'local' | 'credits' | 'freemium' | 'paid', number>,
    rows: [...rows.values()].sort((a, b) => b.count - a.count),
    recent: entries,
  }
}
