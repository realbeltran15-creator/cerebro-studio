'use client'

import { useEffect, useState } from 'react'

export type Persona = { id: string; owner_id: string; project_id: string; name: string; handle: string | null; status: string; bible: unknown; current_identity_version: number | null; budget_eur: number; spent_eur: number; created_at: string; updated_at: string }
export type Reference = { id: string; asset_id: string; category: string; approved: boolean; notes: string | null; created_at: string }
export type IdentityVersion = { id: string; version: number; status: string; traits: unknown; reference_asset_ids: string[]; notes: string | null; created_at: string; approved_at: string | null }
export type QualityReport = { id: string; subject_type: string; subject_id: string; checks: unknown; overall: string }

export const personaStatusLabels: Record<string, string> = { draft: 'Borrador', identity_review: 'Identidad en revisión', approved: 'Identidad aprobada', archived: 'Archivada' }

/** Signed URLs for private assets, fetched once per id. */
export function useSignedUrls(ids: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = [...new Set(ids)].sort().join(',')
  useEffect(() => {
    const wanted = key ? key.split(',') : []
    let alive = true
    void Promise.all(wanted.map(async id => {
      const r = await fetch(`/api/assets/${id}/signed-url`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({})) as { url?: string }
      return [id, j.url ?? ''] as const
    })).then(pairs => { if (alive) setUrls(Object.fromEntries(pairs.filter(([, u]) => u))) })
    return () => { alive = false }
  }, [key])
  return urls
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{label}{children}{hint && <span className="muted small">{hint}</span>}</label>
}
