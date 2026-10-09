'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { BibleEditor } from '../_components/bible-editor'
import { ReferencesPanel } from '../_components/references-panel'
import { IdentityPanel } from '../_components/identity-panel'
import { CatalogPanel, catalogSpecs, type CatalogRow } from '../_components/catalog-panel'
import { ProductionPanel, type Job } from '../_components/production-panel'
import { personaStatusLabels, type IdentityVersion, type Persona, type Reference } from '../_components/shared'

const tabs = [
  ['bible', 'Persona Bible'], ['references', 'Referencias'], ['identity', 'Identidad'], ['voice', 'Voz'],
  ['scenes', 'Escenas'], ['wardrobe', 'Vestuario'], ['production', 'Producción y calidad'],
] as const
type Tab = (typeof tabs)[number][0]

export default function PersonaPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const supabase = getSupabaseBrowserClient()
  const [tab, setTab] = useState<Tab>('bible')
  const [persona, setPersona] = useState<Persona | null>(null)
  const [missing, setMissing] = useState(false)
  const [references, setReferences] = useState<Reference[]>([])
  const [assets, setAssets] = useState<Array<{ id: string; asset_type: string; provenance: Record<string, unknown> | null }>>([])
  const [versions, setVersions] = useState<IdentityVersion[]>([])
  const [voices, setVoices] = useState<CatalogRow[]>([])
  const [scenes, setScenes] = useState<CatalogRow[]>([])
  const [wardrobe, setWardrobe] = useState<CatalogRow[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const { data: p, error: pe } = await supabase.from('vi_personas').select('*').eq('id', id).maybeSingle()
    if (pe) { setError(pe.message); return }
    if (!p) { setMissing(true); return }
    const persona = p as Persona
    setPersona(persona)
    const [r, a, v, vo, sc, wa, jb] = await Promise.all([
      supabase.from('vi_references').select('id,asset_id,category,approved,notes,created_at').eq('persona_id', id).order('created_at'),
      supabase.from('assets').select('id,asset_type,provenance').eq('project_id', persona.project_id).limit(500),
      supabase.from('vi_identity_versions').select('id,version,status,traits,reference_asset_ids,notes,created_at,approved_at').eq('persona_id', id).order('version', { ascending: false }),
      supabase.from('vi_voice_profiles').select('*').eq('persona_id', id).order('created_at'),
      supabase.from('vi_scenes').select('*').eq('persona_id', id).order('created_at'),
      supabase.from('vi_wardrobe').select('*').eq('persona_id', id).order('created_at'),
      supabase.from('vi_generation_jobs').select('id,kind,provider,status,blocked_reasons,prompt,estimated_cost_eur,actual_cost_eur,cost_reported,output_asset_id,error,identity_version,created_at').eq('persona_id', id).order('created_at', { ascending: false }).limit(50),
    ])
    const firstError = [r, a, v, vo, sc, wa, jb].find(x => x.error)?.error
    if (firstError) setError(firstError.message)
    setReferences((r.data ?? []) as Reference[]); setAssets((a.data ?? []) as typeof assets); setVersions((v.data ?? []) as IdentityVersion[])
    setVoices((vo.data ?? []) as CatalogRow[]); setScenes((sc.data ?? []) as CatalogRow[]); setWardrobe((wa.data ?? []) as CatalogRow[]); setJobs((jb.data ?? []) as Job[])
  }, [id, supabase])
  useEffect(() => { void load() }, [load])

  if (missing) return <StudioShell title="Persona no encontrada" eyebrow="PRIVADO"><p className="emptyState">No existe o no tienes acceso. <Link className="open" href="/influencer">Volver</Link></p></StudioShell>
  if (!persona) return <StudioShell title="Cargando…" eyebrow="PRIVADO">{error && <p className="error">{error}</p>}</StudioShell>

  return <StudioShell title={persona.name} eyebrow="VIRTUAL INFLUENCER STUDIO" actions={<><Link className="buttonLink ghost" href="/library">Biblioteca</Link><Link className="buttonLink ghost" href="/influencer">Todas las personas</Link></>}>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="stats" style={{ marginBottom: 12 }}>
      <span className="pill">{personaStatusLabels[persona.status] ?? persona.status}</span>
      <span className={persona.current_identity_version ? 'pill ok' : 'pill warn'}>Identidad {persona.current_identity_version ? `v${persona.current_identity_version}` : 'sin aprobar'}</span>
      <span className="pill">{references.filter(r => r.approved).length}/{references.length} referencias aprobadas</span>
      <span className="pill">Presupuesto {Number(persona.budget_eur).toFixed(2)} EUR</span>
    </div>
    <div className="viTabs" role="tablist">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'bible' && <BibleEditor persona={persona} onSaved={() => void load()} />}
    {tab === 'references' && <ReferencesPanel persona={persona} references={references} assets={assets} locked={persona.current_identity_version !== null} onChanged={() => void load()} />}
    {tab === 'identity' && <IdentityPanel persona={persona} versions={versions} references={references} onChanged={() => void load()} />}
    {tab === 'voice' && <CatalogPanel spec={catalogSpecs.voice} personaId={persona.id} rows={voices} onChanged={() => void load()} />}
    {tab === 'scenes' && <CatalogPanel spec={catalogSpecs.scenes} personaId={persona.id} rows={scenes} onChanged={() => void load()} />}
    {tab === 'wardrobe' && <CatalogPanel spec={catalogSpecs.wardrobe} personaId={persona.id} rows={wardrobe} onChanged={() => void load()} />}
    {tab === 'production' && <ProductionPanel persona={persona} jobs={jobs} voices={voices} scenes={scenes} wardrobe={wardrobe} onChanged={() => void load()} />}
  </StudioShell>
}
