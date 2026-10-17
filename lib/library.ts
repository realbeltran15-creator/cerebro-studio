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

// ---------- Safe deletion ----------
/** What still points at an asset. Publication jobs and render outputs are hard references; derived files only a warning. */
export type AssetReferences = { publications: Array<{ id: string; platform: string; status: string }>; renders: Array<{ id: string }>; derived: Array<{ id: string; asset_type: string }> }

/**
 * Deleting is permanent (the file is removed from storage). It is refused while a publication job uses the file (any status: a published
 * job keeps its record, an approved one would fail or upload something else). Render outputs and derived files (subtitles, versions) are only
 * reported: the montage can be rendered again and derived files are separate files that keep working.
 */
export function deletionCheck(refs: AssetReferences): { allowed: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = []
  if (refs.publications.length) reasons.push(`Lo usa${refs.publications.length > 1 ? 'n' : ''} ${refs.publications.length} publicación${refs.publications.length > 1 ? 'es' : ''} (${refs.publications.map(p => `${p.platform}: ${p.status}`).join(', ')}). Quítalo de la publicación antes de borrarlo.`)
  const warnings = [
    ...(refs.renders.length ? ['Es el resultado de un montaje guardado: el montaje se conserva y podrás volver a renderizarlo.'] : []),
    ...(refs.derived.length ? [`Tiene ${refs.derived.length} archivo${refs.derived.length > 1 ? 's' : ''} derivado${refs.derived.length > 1 ? 's' : ''} (p. ej. subtítulos) que se conservan.`] : []),
  ]
  return { allowed: reasons.length === 0, reasons, warnings }
}

/** Library page size: the list is loaded in pages instead of a fixed cap of 500 rows. */
export const LIBRARY_PAGE = 120

/** Download a text file in the browser (SRT/VTT exports). */
export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
