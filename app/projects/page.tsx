'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase/client'

type Project = { id:string; name:string; description:string|null; status:string; created_at:string }

export default function ProjectsPage() {
  const [projects,setProjects]=useState<Project[]>([])
  const [name,setName]=useState('')
  const [message,setMessage]=useState('Comprobando conexión con Supabase…')
  const [busy,setBusy]=useState(false)
  const [authenticated,setAuthenticated]=useState<boolean|null>(null)

  async function loadProjects() {
    try {
      const supabase=createClient()
      const {data:{user},error:userError}=await supabase.auth.getUser()
      if(userError) throw userError
      if(!user){setAuthenticated(false);setMessage('Supabase conectado. Inicia sesión para acceder a tus proyectos protegidos por RLS.');setProjects([]);return}
      setAuthenticated(true)
      const {data,error}=await supabase.from('projects').select('id,name,description,status,created_at').order('created_at',{ascending:false})
      if(error) throw error
      setProjects((data??[]) as Project[])
      setMessage(`Sesión segura activa · ${data?.length??0} proyecto(s).`)
    } catch(error){setMessage(`Error de conexión: ${error instanceof Error?error.message:'desconocido'}`)}
  }

  useEffect(()=>{void loadProjects()},[])

  async function createProject(event:FormEvent){
    event.preventDefault(); const cleanName=name.trim(); if(!cleanName)return; setBusy(true)
    try{
      const supabase=createClient(); const {data:{user},error:userError}=await supabase.auth.getUser(); if(userError)throw userError
      if(!user){setAuthenticated(false);setMessage('La sesión ha caducado. Inicia sesión de nuevo.');return}
      const {error}=await supabase.from('projects').insert({owner_id:user.id,name:cleanName,status:'draft'}); if(error)throw error
      setName(''); await loadProjects()
    }catch(error){setMessage(`No se pudo crear: ${error instanceof Error?error.message:'error desconocido'}`)}finally{setBusy(false)}
  }

  async function signOut(){const supabase=createClient();await supabase.auth.signOut();setAuthenticated(false);setProjects([]);setMessage('Sesión cerrada correctamente.')}

  return <main className="projectsPage"><section className="projectsPanel">
    <Link className="backLink" href="/">← Centro de operaciones</Link><small>WORKSPACE</small><h1>Proyectos</h1>
    <p className="connectionStatus">{message}</p>
    {authenticated===false ? <Link className="buttonLink" href="/login">Iniciar sesión</Link> : authenticated===true ? <>
      <form className="projectForm" onSubmit={createProject}><input aria-label="Nombre del proyecto" value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre del nuevo proyecto"/><button disabled={busy}>{busy?'Creando…':'+ Crear proyecto'}</button></form>
      <button className="secondaryButton" onClick={signOut}>Cerrar sesión</button>
      <div className="projectList">{projects.length===0?<p className="emptyState">Todavía no hay proyectos. Crea el primero arriba.</p>:projects.map(project=><article key={project.id}><h3>{project.name}</h3><p>Estado: {project.status}</p></article>)}</div>
    </> : null}
  </section></main>
}
