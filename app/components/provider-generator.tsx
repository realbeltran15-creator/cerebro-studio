'use client'

import { FormEvent, useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { StudioShell } from './studio-shell'

type Project={id:string;name:string}
type Props={title:string;kind:'image'|'voice'|'video';description:string}
const imageStyles=[['cinematic','Cinematográfico'],['photorealistic','Fotorrealista'],['documentary','Documental'],['illustration','Ilustración'],['3d','3D'],['anime','Anime'],['vintage','Vintage'],['minimal','Minimalista'],['fantasy','Fantasía'],['surreal','Surrealista']] as const

export function ProviderGenerator({title,kind,description}:Props){
 const supabase=getSupabaseBrowserClient();const[projects,setProjects]=useState<Project[]>([]);const[projectId,setProjectId]=useState('');const[input,setInput]=useState('');const[style,setStyle]=useState('cinematic');const[busy,setBusy]=useState(false);const[result,setResult]=useState('')
 useEffect(()=>{void(async()=>{const{data}=await supabase.from('projects').select('id,name').order('updated_at',{ascending:false});const rows=(data??[]) as Project[];setProjects(rows);if(rows[0])setProjectId(rows[0].id)})()},[])
 async function submit(e:FormEvent){e.preventDefault();if(!projectId||!input.trim())return;setBusy(true);setResult('');try{const payload=kind==='voice'?{projectId,text:input}:kind==='image'?{projectId,prompt:input,style}:{projectId,prompt:input};const r=await fetch(`/api/providers/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const json=await r.json() as {error?:string;asset?:{id?:string}};if(!r.ok)throw new Error(json.error??'Generation failed');setResult(`Generado y guardado${json.asset?.id?` · ${json.asset.id}`:''}`)}catch(err){setResult(err instanceof Error?err.message:'Generation failed')}finally{setBusy(false)}}
 return <StudioShell title={title}><div className="hero"><div><small>PROVEEDOR IA</small><h2>{title}</h2><p>{description}</p></div></div><article><form onSubmit={submit}><label>Proyecto</label><select value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>{kind==='image'&&<><label>Estilo visual</label><select value={style} onChange={e=>setStyle(e.target.value)}>{imageStyles.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}<label>{kind==='voice'?'Texto':'Prompt'}</label><textarea value={input} onChange={e=>setInput(e.target.value)} rows={6} placeholder={kind==='voice'?'Texto para narrar':'Describe el resultado que quieres generar'} /><button disabled={busy||!projectId||!input.trim()}>{busy?'Generando…':'Generar'}</button></form>{result&&<p>{result}</p>}</article></StudioShell>
}
