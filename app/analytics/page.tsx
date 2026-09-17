'use client'

import { useEffect, useState } from 'react'
import { StudioShell } from '../components/studio-shell'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

type Snapshot={id:string;observed_at:string;observed_metrics:Record<string,unknown>;calculated_metrics:Record<string,unknown>}
export default function AnalyticsPage(){const supabase=getSupabaseBrowserClient(); const [rows,setRows]=useState<Snapshot[]>([]); const [error,setError]=useState(''); useEffect(()=>{void (async()=>{const {data,error}=await supabase.from('metric_snapshots').select('id,observed_at,observed_metrics,calculated_metrics').order('observed_at',{ascending:false}).limit(50); if(error)setError(error.message); else setRows((data??[]) as Snapshot[])})()},[])
 return <StudioShell title="Analytics"><div className="hero"><div><small>DATOS OBSERVADOS</small><h2>Memoria de rendimiento</h2><p>Las métricas observadas se muestran separadas de los cálculos de Cerebro Studio.</p></div><div className="status"><b>{rows.length}</b><span>snapshots cargados</span><span>Sin predicciones presentadas como hechos</span></div></div>{error&&<p className="error">{error}</p>}<div className="grid">{rows.map(r=><article key={r.id}><small>{new Date(r.observed_at).toLocaleString()}</small><h3>Métricas observadas</h3><pre>{JSON.stringify(r.observed_metrics,null,2)}</pre><h3>Cálculos Cerebro</h3><pre>{JSON.stringify(r.calculated_metrics,null,2)}</pre></article>)}</div></StudioShell>}
