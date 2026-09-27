'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StudioShell } from '../components/studio-shell'
import { Icon } from '../components/studio-icon'
import { createClient } from '../../lib/supabase/client'
import { projectStatusLabel } from '@/lib/progress'

type Project = { id: string; name: string; description: string | null; status: string; created_at: string; updated_at: string }

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState('Cargando…')
  const [busy, setBusy] = useState(false)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  async function loadProjects() {
    try {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) { setAuthenticated(false); setMessage('Inicia sesión para acceder a tus proyectos.'); setProjects([]); return }
      setAuthenticated(true)
      const { data, error } = await supabase.from('projects').select('id,name,description,status,created_at,updated_at').order('updated_at', { ascending: false })
      if (error) throw error
      setProjects((data ?? []) as Project[])
      setMessage('')
    } catch (error) { setMessage(`Error de conexión: ${error instanceof Error ? error.message : 'desconocido'}`) }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const legacy = params.get('project')
    if (legacy) { router.replace(`/projects/${encodeURIComponent(legacy)}`); return }
    setFilter(params.get('q') ?? '')
    if (params.get('new')) setTimeout(() => nameInput.current?.focus(), 50)
    void loadProjects()
  }, [router])

  async function createProject(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    setBusy(true)
    try {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) { setAuthenticated(false); setMessage('La sesión ha caducado. Inicia sesión de nuevo.'); return }
      const { data, error } = await supabase.from('projects').insert({ owner_id: user.id, name: cleanName, status: 'draft', target_platforms: ['youtube'] }).select('id').single()
      if (error) throw error
      router.push(`/projects/${data.id}`)
    } catch (error) { setMessage(`No se pudo crear: ${error instanceof Error ? error.message : 'error desconocido'}`) } finally { setBusy(false) }
  }

  async function signOut() {
    await createClient().auth.signOut()
    setAuthenticated(false); setProjects([]); setMessage('Sesión cerrada.')
  }

  const q = filter.trim().toLowerCase()
  const visible = q ? projects.filter(p => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q)) : projects

  return (
    <StudioShell title="Proyectos" actions={authenticated ? <button type="button" className="ghost" onClick={signOut}>Cerrar sesión</button> : null}>
      {message && <p className="connectionStatus">{message}</p>}
      {authenticated === false && <Link className="buttonLink" href="/login?next=/projects">Iniciar sesión</Link>}
      {authenticated && <>
        <form className="projectForm" onSubmit={createProject}>
          <input ref={nameInput} id="new-project-name" aria-label="Nombre del proyecto" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del nuevo proyecto (p. ej. Juliane Koepcke)" maxLength={160} />
          <button disabled={busy}><Icon name="plus" size={16} />{busy ? 'Creando…' : 'Crear proyecto'}</button>
        </form>
        <input id="project-filter" aria-label="Filtrar proyectos" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por nombre o descripción" style={{ marginBottom: 14 }} />
        {visible.length === 0 ? <p className="emptyState">{projects.length ? 'Ningún proyecto coincide con el filtro.' : 'Todavía no hay proyectos. Crea el primero arriba o conviértelo desde una oportunidad.'}</p> : (
          <div className="list">
            {visible.map(p => (
              <Link className="listItem" key={p.id} href={`/projects/${p.id}`}>
                <div><b>{p.name}</b><span>{p.description ? p.description.slice(0, 120) : 'Sin descripción'} · actualizado {new Date(p.updated_at).toLocaleDateString()}</span></div>
                <span className="pill">{projectStatusLabel(p.status)}</span>
              </Link>
            ))}
          </div>
        )}
      </>}
    </StudioShell>
  )
}
