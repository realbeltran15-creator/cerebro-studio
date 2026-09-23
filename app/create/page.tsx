'use client'

import { FormEvent, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { ProjectRow } from '@/lib/types/database'

type Board = { id:string; project_id:string; title:string; aspect_ratio:string; version:number; created_at:string }
type Scene = { id:string; storyboard_id:string; position:number; duration_ms:number; narration:string|null; visual_prompt:string|null; video_prompt:string|null; ambient_prompt:string|null }
export default function CreatePage(){
 const supabase=getSupabaseBrowserClient()
 const [projects,setProjects]=useState<ProjectRow[]>([])
 const [boards,setBoards]=useState<Board[]>([])
 const [scenes,setScenes]=useState<Scene[]>([])
 const [projectId,setProjectId]=useState('')
 const [title,setTitle]=useState('')
 const [selected,setSelected]=useState('')
 const [narration,setNarration]=useState('')
 const [visual,setVisual]=useState('')
 const [video,setVideo]=useState('')
 const [ambient,setAmbient]=useState('')
 const [duration,setDuration]=useState(5)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [busy,setBusy]=useState(false)
 async function load(){
  const [{data:p,error:pe},{data:b,error:be}]=await Promise.all([
   supabase.from('projects').select('*').order('updated_at',{ascending:false}),
   supabase.from('storyboards').select('id,project_id,title,aspect_ratio,version,created_at').order('created_at',{ascending:false})
  ])
  setProjects((p??[]) as ProjectRow[]);setBoards((b??[]) as Board[])
  const requestedProject=new URLSearchParams(window.location.search).get('project')
  if(requestedProject&&((p??[]) as ProjectRow[]).some(project=>project.id===requestedProject))setProjectId(requestedProject)
  if(pe||be)setError(pe?.message||be?.message||'Error al cargar')
 }
 async function loadScenes(id:string){
  const {data,error:e}=await supabase.from('scenes').select('id,storyboard_id,position,duration_ms,narration,visual_prompt,video_prompt,ambient_prompt').eq('storyboard_id',id).order('position')
  setScenes((data??[]) as Scene[])
  if(e)setError(e.message)
 }
 useEffect(()=>{void load()},[])
 async function create(event:FormEvent){
  event.preventDefault();setError('');setNotice('')
  const {data:{user}}=await supabase.auth.getUser()
  if(!user||!projectId||!title.trim())return
  setBusy(true)
  const {data,error:e}=await supabase.from('storyboards').insert({owner_id:user.id,project_id:projectId,title:title.trim(),aspect_ratio:'16:9'}).select('id').single()
  setBusy(false)
  if(e){setError(e.message);return}
  setTitle('');setNotice('Storyboard creado. Puedes añadir escenas sin generar vídeos ni incurrir en costes.')
  await load()
  if(data){setSelected(data.id);setScenes([])}
 }
 async function addScene(event:FormEvent){
  event.preventDefault();setError('');setNotice('')
  if(!selected||busy)return
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return
  setBusy(true)
  const {error:e}=await supabase.from('scenes').insert({
   owner_id:user.id,storyboard_id:selected,position:scenes.length+1,
   duration_ms:Math.round(duration*1000),narration:narration.trim()||null,
   visual_prompt:visual.trim()||null,video_prompt:video.trim()||null,ambient_prompt:ambient.trim()||null
  })
  setBusy(false)
  if(e){setError(e.message);return}
  setNarration('');setVisual('');setVideo('');setAmbient('');setDuration(5)
  setNotice('Escena guardada. No se ha solicitado ninguna generación de pago.')
  await loadScenes(selected)
 }
 return <StudioShell title="Crear vídeo">
  <div className="hero"><div><small>PRODUCCIÓN</small><h2>Proyecto → storyboard → escenas</h2><p>Planifica escenas y guarda el guion en Supabase sin generar contenido de pago ni publicar.</p></div><div className="status"><b>{boards.length}</b><span>storyboards</span><span>Sin publicación automática</span></div></div>
  <form className="projectForm" onSubmit={create}>
   <select value={projectId} onChange={e=>setProjectId(e.target.value)} required><option value="">Selecciona proyecto</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
   <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Título del storyboard" required maxLength={160}/>
   <button disabled={busy}>Crear storyboard</button>
  </form>
  {error&&<p className="error" role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {projectId&&<p role="status">Proyecto seleccionado: {projects.find(p=>p.id===projectId)?.name||'—'}</p>}
  <div className="grid">{boards.filter(b=>!projectId||b.project_id===projectId).map(b=><article key={b.id}><small>Versión {b.version} · {b.aspect_ratio}</small><h3>{b.title}</h3><p>Proyecto: {projects.find(p=>p.id===b.project_id)?.name||b.project_id}</p><button type="button" onClick={()=>{setSelected(b.id);setError('');setNotice('');void loadScenes(b.id)}}>Editar escenas</button></article>)}</div>
  {selected&&<section className="hero"><div><small>STORYBOARD SELECCIONADO</small><h2>{boards.find(b=>b.id===selected)?.title||'Storyboard'}</h2><p>{scenes.length} escenas · {scenes.reduce((sum,s)=>sum+s.duration_ms,0)/1000} segundos planificados</p>
   <div className="grid">{scenes.map(s=><article key={s.id}><small>Escena {s.position} · {s.duration_ms/1000} s</small><p><b>Narración:</b> {s.narration||'Sin narración'}</p><p><b>Imagen:</b> {s.visual_prompt||'Sin prompt'}</p><p><b>Vídeo:</b> {s.video_prompt||'Sin prompt'}</p><p><b>Ambiente:</b> {s.ambient_prompt||'Sin prompt'}</p></article>)}</div>
   <form className="projectForm" onSubmit={addScene}>
    <h3>Añadir escena {scenes.length+1}</h3>
    <label>Duración estimada (segundos)<input type="number" min="1" max="600" step="1" value={duration} onChange={e=>setDuration(Number(e.target.value))} required/></label>
    <label>Narración<textarea value={narration} onChange={e=>setNarration(e.target.value)} placeholder="Texto que dirá la voz"/></label>
    <label>Prompt de imagen<textarea value={visual} onChange={e=>setVisual(e.target.value)} placeholder="Descripción visual de la escena"/></label>
    <label>Prompt de vídeo<textarea value={video} onChange={e=>setVideo(e.target.value)} placeholder="Movimiento, cámara y acción"/></label>
    <label>Sonido ambiente<textarea value={ambient} onChange={e=>setAmbient(e.target.value)} placeholder="Música o ambiente"/></label>
    <button disabled={busy}>Guardar escena (sin coste de IA)</button>
   </form>
  </div></section>}
 </StudioShell>
}
