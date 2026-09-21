'use client'

import { FormEvent, useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { ProjectRow } from '@/lib/types/database'

type Board={id:string;project_id:string;title:string;aspect_ratio:string;version:number;created_at:string}
export default function CreatePage(){const supabase=getSupabaseBrowserClient(); const [projects,setProjects]=useState<ProjectRow[]>([]); const [boards,setBoards]=useState<Board[]>([]); const [projectId,setProjectId]=useState(''); const [title,setTitle]=useState(''); const [error,setError]=useState('')
 async function load(){const [{data:p,error:pe},{data:b,error:be}]=await Promise.all([supabase.from('projects').select('*').order('updated_at',{ascending:false}),supabase.from('storyboards').select('id,project_id,title,aspect_ratio,version,created_at').order('created_at',{ascending:false})]); if(pe||be)setError(pe?.message||be?.message||'Error'); setProjects((p??[]) as ProjectRow[]); setBoards((b??[]) as Board[])}
 useEffect(()=>{void load()},[])
 async function create(e:FormEvent){e.preventDefault(); const {data:{user}}=await supabase.auth.getUser(); if(!user||!projectId||!title)return; const {error}=await supabase.from('storyboards').insert({owner_id:user.id,project_id:projectId,title,aspect_ratio:'16:9'}); if(error)setError(error.message); else {setTitle('');void load()}}
 return <StudioShell title="Crear vídeo"><div className="hero"><div><small>PRODUCCIÓN</small><h2>Proyecto → storyboard → render</h2><p>Inicia un flujo de producción persistente en Supabase.</p></div><div className="status"><b>{boards.length}</b><span>storyboards</span><span>Sin publicación automática</span></div></div><form className="projectForm" onSubmit={create}><select value={projectId} onChange={e=>setProjectId(e.target.value)} required><option value="">Selecciona proyecto</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Título del storyboard" required/><button>Crear storyboard</button></form>{error&&<p className="error">{error}</p>}<div className="grid">{boards.map(b=><article key={b.id}><small>Versión {b.version} · {b.aspect_ratio}</small><h3>{b.title||'Storyboard'}</h3><p>Proyecto: {projects.find(p=>p.id===b.project_id)?.name||b.project_id}</p></article>)}</div></StudioShell>}
