/**
 * Numbers behind the «Almacenamiento» panel. Pure: it only adds up what the account's own rows say (each asset records its byte size).
 * Nothing here deletes anything; duplicates are reported so the person decides.
 */
export type StoredAsset = { id: string; project_id: string | null; asset_type: string; source_provider: string | null; bytes: number; fingerprint: string | null; driveFileId: string | null; title: string; created_at: string }
export type DuplicateGroup = { key: string; count: number; bytesEach: number; extraBytes: number; titles: string[]; ids: string[] }

const EXPORT_PROVIDERS = new Set(['browser-render', 'browser-convert'])
export const kindOfAsset = (a: Pick<StoredAsset, 'asset_type' | 'source_provider'>) => (EXPORT_PROVIDERS.has(a.source_provider ?? '') ? 'exportación' : a.asset_type)

export function summarize(assets: StoredAsset[], projectNames: Record<string, string> = {}) {
  const byKind: Record<string, { files: number; bytes: number }> = {}
  const byProject: Record<string, { name: string; files: number; bytes: number }> = {}
  let total = 0
  let unknownSize = 0
  for (const a of assets) {
    const k = kindOfAsset(a)
    byKind[k] = { files: (byKind[k]?.files ?? 0) + 1, bytes: (byKind[k]?.bytes ?? 0) + a.bytes }
    const pid = a.project_id ?? 'library'
    byProject[pid] = { name: pid === 'library' ? 'Biblioteca general' : projectNames[pid] ?? 'Proyecto', files: (byProject[pid]?.files ?? 0) + 1, bytes: (byProject[pid]?.bytes ?? 0) + a.bytes }
    total += a.bytes
    if (!a.bytes) unknownSize++
  }
  const groups = new Map<string, StoredAsset[]>()
  for (const a of assets) {
    const key = a.fingerprint ? `fp:${a.fingerprint}` : a.driveFileId ? `drive:${a.driveFileId}:${a.bytes}` : ''
    if (key) groups.set(key, [...(groups.get(key) ?? []), a])
  }
  const duplicates: DuplicateGroup[] = [...groups.entries()].filter(([, l]) => l.length > 1).map(([key, l]) => ({ key, count: l.length, bytesEach: l[0].bytes, extraBytes: l.slice(1).reduce((n, x) => n + x.bytes, 0), titles: [...new Set(l.map(x => x.title))].slice(0, 3), ids: l.map(x => x.id) })).sort((a, b) => b.extraBytes - a.extraBytes)
  return { unknownSize, totalBytes: total, files: assets.length, byKind, byProject: Object.values(byProject).sort((a, b) => b.bytes - a.bytes), duplicates, duplicateExtraBytes: duplicates.reduce((n, d) => n + d.extraBytes, 0) }
}

/** Montage metadata: how many bytes of JSON the saved montages take (what 300 repetitions cost is here, not in media). */
export function metadataBytes(compositions: unknown[]) { return compositions.reduce<number>((n, c) => n + JSON.stringify(c ?? {}).length, 0) }
