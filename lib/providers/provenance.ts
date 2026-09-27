/**
 * Provenance recorded with every provider-generated asset. Cost is only filled when the provider
 * reports it; otherwise it stays null with reported=false (usage is kept so cost can be derived later).
 */
export type AssetCost = { amount: number | null; currency: string | null; reported: boolean }

export function generationProvenance(input: {
  provider: string
  requestId: string
  projectId: string
  mimeType: string
  externalId?: string | null
  purpose?: string
  metadata?: Record<string, unknown>
  now?: Date
}) {
  const meta = input.metadata ?? {}
  const cost = meta.cost && typeof meta.cost === 'object' ? meta.cost as AssetCost : { amount: null, currency: null, reported: false }
  return {
    ...meta,
    provider: input.provider,
    model: typeof meta.model === 'string' ? meta.model : null,
    generatedAt: (input.now ?? new Date()).toISOString(),
    projectId: input.projectId,
    requestId: input.requestId,
    externalId: input.externalId ?? null,
    mimeType: input.mimeType,
    usage: meta.usage ?? null,
    cost,
    ...(input.purpose ? { purpose: input.purpose } : {}),
  }
}
