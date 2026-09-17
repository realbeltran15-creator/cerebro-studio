'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { OpportunityRow } from '@/lib/types/database'

export default function OpportunitiesPage(){
 const supabase=getSupabaseBrowserClient(); const router=useRouter()
 const [items,setItems]=useState<OpportunityRow[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('')
 async function load(){setLoading(true); const {data,error}=await supabase.from('opportunities').select('*').order('created_at',{ascending:false}); if(error)setError(error.message); else setItems((data??[]) as OpportunityRow[]); setLoading(false)}
 useEffect(()=>{void load()},[])
 async function createProject(e:FormEvent<HTMLFormElement>,o:OpportunityRow){e.preventDefault(); setError(''); const {data:{user}}=await supabase.auth.getUser(); if(!user)return setError('Sesión requerida.'); const {data,error}=await supabase.from('projects').insert({owner_id:user.id,name:o.title,description:`Oportunidad ${o.source_platform}${o.query?` · ${o.query}`:''}`,status:'draft',target_platforms:['youtube']}).select('id').single(); if(error)return setError(error.message); await supabase.from('opportunities').update({project_id:data.id,status:'candidate'}).eq('id',o.id); router.push(`/projects?project=${data.id}`)}
 return <StudioShell title="Oportunidades"><div className="hero"><div><small>DETECCIÓN → PROYECTO</small><h2>Oportunidades accionables</h2><p>Revisa evidencia observada y convierte una señal en un proyecto real.</p></div><div className="status"><b>{items.length}</b><span>oportunidades disponibles</span><span>Publicación real bloqueada</span></div></div>{error&&<p className="error">{error}</p>}{loading?<p>Cargando…</p>:<div className="grid">{items.map(o=><article key={o.id}><small>{o.region||'Global'} · {o.language||'—'}</small><h3>{o.title}</h3><p>Estado: {o.status}</p><p>Fuente: {o.source_platform}</p><form onSubmit={e=>createProject(e,o)}><button disabled={Boolean(o.project_id)}>{o.project_id?'Proyecto creado':'Convertir en proyecto'}</button></form></article>)}</div>}</StudioShell>
}