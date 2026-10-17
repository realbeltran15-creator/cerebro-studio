/** Reads an asset's provenance into the fields the Biblioteca shows. Pure; tested. */
export type LibraryAsset = {
  id: string; asset_type: string; project_id: string | null; storage_path: string | null; source_provider: string | null
  source_url: string | null; license_status: string; provenance: Record<string, unknown> | null; created_at: string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function originOf(a: LibraryAsset): 'generated' | 'imported' | 'uploaded' | 'render' {
  const p = a.provenance ?? {}
  if (a.source_provider === 'browser-render' || p.purpose === 'render' || p.purpose === 'short') return 'render'
  if (str(p.importedAt)) return 'imported'
  if (a.license_status === 'generated' || str(p.requestId) || str(p.catalogModel)) return 'generated'
  return 'uploaded'
}

export function describeAsset(a: LibraryAsset) {
  const p = a.provenance ?? {}
  const options = p.options && typeof p.options === 'object' ? p.options as Record<string, unknown> : null
  const params = [
    options?.format && `formato ${options.format}`, options?.durationSeconds && `${options.durationSeconds} s`, options?.quality && `calidad ${options.quality}`,
    options?.variants && Number(options.variants) > 1 && `${options.variants} variantes`, p.preset && `estilo ${p.preset}`, p.voice && `voz ${p.voice}`,
    p.loop && 'en bucle', p.instrumental && 'instrumental', p.format && !options && `formato ${p.format}`,
  ].filter(Boolean).join(' · ')
  const cost = p.cost && typeof p.cost === 'object' ? p.cost as Record<string, unknown> : null
  const credits = p.credits && typeof p.credits === 'object' ? (p.credits as Record<string, unknown>).credits : null
  const costText = [
    cost?.reported === true && typeof cost.amount === 'number' ? `real $${cost.amount.toFixed(3)}` : null,
    typeof p.estimateUsd === 'number' && p.estimateUsd > 0 ? `estimado $${p.estimateUsd.toFixed(3)}${p.priceConfirmed === false ? ' (referencia)' : ''}` : null,
    typeof credits === 'number' ? `${credits} créditos` : null,
  ].filter(Boolean).join(' · ')
  return {
    title: str(p.title) ?? str(p.originalPrompt) ?? str(p.prompt) ?? str(p.text) ?? str(p.concept) ?? a.asset_type,
    provider: str(p.providerName) ?? str(p.provider) ?? a.source_provider ?? 'Subido por ti',
    model: str(p.catalogModel) ?? str(p.model),
    tier: str(p.costTier)?.replace('free_allowance', 'free') ?? (originOf(a) === 'imported' ? 'free' : null),
    cost: costText,
    prompt: str(p.originalPrompt) ?? str(p.prompt) ?? str(p.text),
    finalPrompt: str(p.finalPrompt),
    params: params || null,
    sceneId: str(p.sceneId),
    license: str(p.license) ?? str(p.licenseNotes),
    attribution: str(p.attribution),
    sourceUrl: (a.source_url && /^https?:\/\//.test(a.source_url) ? a.source_url : null) ?? str(p.originalUrl),
  }
}
