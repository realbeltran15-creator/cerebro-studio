'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { emptyBible } from '@/lib/virtual-influencer/bible'
import { personaStatusLabels, type Persona } from './_components/shared'

export default function InfluencerStudioPage() {
  const supabase = getSupabaseBrowserClient()
  const [items, setItems] = useState<Persona[]>([])
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('vi_personas').select('*').order('updated_at', { ascending: false })
    if (e) setError(e.message); else setItems((data ?? []) as Persona[])
    setLoaded(true)
  }, [supabase])
  useEffect(() => { void load() }, [load])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('La sesión ha caducado.')
      // Each persona gets its own private project so references and outputs live in the Biblioteca.
      const { data: project, error: pe } = await supabase.from('projects').insert({ owner_id: user.id, name: `Influencer · ${name.trim()}`.slice(0, 120), description: 'Proyecto privado de Virtual Influencer Studio (referencias y resultados).' }).select('id').single()
      if (pe) throw pe
      const { data: persona, error: e } = await supabase.from('vi_personas').insert({ owner_id: user.id, project_id: (project as { id: string }).id, name: name.trim(), handle: handle.trim().toLowerCase() || null, bible: emptyBible() }).select('id').single()
      if (e) { await supabase.from('projects').delete().eq('id', (project as { id: string }).id); throw e }
      window.location.href = `/influencer/${(persona as { id: string }).id}`
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la persona.')
    } finally { setBusy(false) }
  }

  return <StudioShell title="Virtual Influencer Studio" eyebrow="PRIVADO">
    {error && <p className="error" role="alert">{error}</p>}
    <p className="warnBox" style={{ marginBottom: 14 }}>Módulo privado. Cada persona se declara siempre como generada por IA, debe ser adulta y no puede imitar a una persona real. Con presupuesto 0 EUR no se genera contenido de pago: puedes definir la persona, sus referencias, su identidad, su voz, escenas y vestuario, y revisar la calidad.</p>
    <section className="panel" style={{ marginBottom: 18 }}>
      <form onSubmit={create} className="field-row" style={{ alignItems: 'end' }}>
        <label htmlFor="vi-name">Nombre de la persona<input id="vi-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>
        <label htmlFor="vi-handle">Handle (opcional)<input id="vi-handle" value={handle} onChange={e => setHandle(e.target.value)} pattern="[a-zA-Z0-9_.]{2,40}" placeholder="nombre_de_usuario" /></label>
        <div><button disabled={busy || !name.trim()}><Icon name="plus" size={16} />{busy ? 'Creando…' : 'Crear persona'}</button></div>
      </form>
    </section>
    <h3 className="sectionTitle">Personas ({items.length})</h3>
    {loaded && items.length === 0 ? <p className="emptyState">Todavía no hay personas.</p> : <div className="list">
      {items.map(p => <Link key={p.id} href={`/influencer/${p.id}`} className="listItem">
        <div><b>{p.name}{p.handle ? ` · @${p.handle}` : ''}</b><span>{personaStatusLabels[p.status] ?? p.status} · identidad {p.current_identity_version ? `v${p.current_identity_version}` : 'sin aprobar'} · presupuesto {Number(p.budget_eur).toFixed(2)} EUR (gastado {Number(p.spent_eur).toFixed(2)})</span></div>
        <Icon name="arrow" size={16} />
      </Link>)}
    </div>}
  </StudioShell>
}
