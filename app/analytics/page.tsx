'use client'

import { useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

type Snapshot={id:number;platform:string;external_content_id:string;metric_date:string;observed:Record<string,unknown>;calculated:Record<string,unknown>}
export default function AnalyticsPage(){const supabase=getSupabaseBrowserClient(); const [rows,setRows]=useState<Snapshot[]>([]); const [error,setError]=useState(''); useEffect(()=>{void (async()=>{const {data,error}=await supabase.from('metric_snapshots').select('id,platform,external_content_id,metric_date,observed,calculated').order('metric_date',{ascending:false}).limit(50); if(error)setError(error.message); else setRows((data??[]) as Snapshot[])})()},[])
 return <StudioShell title="Analytics"><div className="hero"><div><small>DATOS OBSERVADOS</small><h2>Memoria de rendimiento</h2><p>Las métricas observadas se muestran separadas de los cálculos de Cerebro Studio.</p></div><div className="status"><b>{rows.length}</b><span>snapshots cargados</span><span>Sin predicciones presentadas como hechos</span></div></div>{error&&<p className="error">{error}</p>}{rows.length===0&&!error&&<p className="emptyState">Sin métricas observadas. Se importarán al conectar YouTube Analytics (OAuth pendiente).</p>}<div className="grid">{rows.map(r=><article key={r.id}><small>{r.platform} · {r.external_content_id} · {r.metric_date}</small><h3>Métricas observadas</h3><pre>{JSON.stringify(r.observed,null,2)}</pre><h3>Cálculos Cerebro</h3><pre>{JSON.stringify(r.calculated,null,2)}</pre></article>)}</div></StudioShell>}
