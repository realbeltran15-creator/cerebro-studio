'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase/client'

type Project = {
  id: string
  name: string
  description: string | null
  status: string
  created_at: string
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('Comprobando conexión con Supabase…')
  const [busy, setBusy] = useState(false)

  async function loadProjects() {
    try {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) {
        setMessage('Supabase responde correctamente. Falta iniciar sesión para crear y leer proyectos protegidos por RLS.')
        setProjects([])
        return
      }
      const { data, error } = await supabase
        .from('projects')
        .select('id,name,description,status,created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      setProjects((data ?? []) as Project[])
      setMessage(`Supabase conectado · ${data?.length ?? 0} proyecto(s) accesible(s) para esta cuenta.`)
    } catch (error) {
      setMessage(`Error de conexión: ${error instanceof Error ? error.message : 'desconocido'}`)
    }
  }

  useEffect(() => { void loadProjects() }, [])

  async function createProject(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    setBusy(true)
    try {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) {
        setMessage('Necesitas iniciar sesión antes de crear un proyecto. La base de datos está protegida por RLS.')
        return
      }
      const { error } = await supabase.from('projects').insert({ owner_id: user.id, name: cleanName, status: 'draft' })
      if (error) throw error
      setName('')
      await loadProjects()
    } catch (error) {
      setMessage(`No se pudo crear: ${error instanceof Error ? error.message : 'error desconocido'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="projectsPage">
      <section className="projectsPanel">
        <Link className="backLink" href="/">← Centro de operaciones</Link>
        <small>WORKSPACE</small>
        <h1>Proyectos</h1>
        <p className="connectionStatus">{message}</p>
        <form className="projectForm" onSubmit={createProject}>
          <input aria-label="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del nuevo proyecto" />
          <button disabled={busy}>{busy ? 'Creando…' : '+ Crear proyecto'}</button>
        </form>
        <div className="projectList">
          {projects.map((project) => (
            <article key={project.id}>
              <h3>{project.name}</h3>
              <p>Estado: {project.status}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
