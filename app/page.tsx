'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { StudioShell } from './components/studio-shell'
import { Icon } from './components/studio-icon'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { moduleStateLabels, studioModules } from '@/lib/module-status'
import { formatDuration } from '@/lib/scripts'
import { overviewIndex, projectProgress, projectStatusLabel, type ProgressInput } from '@/lib/progress'

type Project = { id: string; name: string; status: string; target_platforms: string[] | null; updated_at: string }
type Channel = { provider: string; status: string; external_account_name: string | null }
type Snapshot = { observed: Record<string, unknown>; metric_date: string }

const flow = [
  ['Idea', 'Tema y formato'], ['Guion', 'Estructura y narración'], ['Medios', 'Imágenes / Vídeo / Voz'],
  ['Editar', 'Montaje y subtítulos'], ['Publicar', 'Con tu aprobación'], ['Analizar', 'Mejora continua'],
] as const

const channels = [
  { id: 'youtube', name: 'YouTube', color: '#ff0033', letter: '▶' },
  { id: 'instagram', name: 'Instagram', color: 'linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7)', letter: 'IG' },
  { id: 'tiktok', name: 'TikTok', color: '#111', letter: '♪' },
]

function coverFor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return `linear-gradient(135deg,hsl(${h} 55% 32%),hsl(${(h + 50) % 360} 60% 18%))`
}

function sumMetric(rows: Snapshot[], key: string) {
  let total = 0, seen = false
  for (const r of rows) { const v = r.observed?.[key]; if (typeof v === 'number') { total += v; seen = true } }
  return seen ? total : null
}

export default function Home() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [progress, setProgress] = useState<Record<string, ProgressInput>>({})
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [connections, setConnections] = useState<Channel[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setSignedIn(false); return }
        setSignedIn(true)
        const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10)
        const [p, c, m] = await Promise.all([
          supabase.from('projects').select('id,name,status,target_platforms,updated_at').order('updated_at', { ascending: false }).limit(4),
          supabase.from('channel_connections').select('provider,status,external_account_name'),
          supabase.from('metric_snapshots').select('observed,metric_date').gte('metric_date', since),
        ])
        if (p.error) throw p.error
        const rows = (p.data ?? []) as Project[]
        setProjects(rows)
        setConnections((c.data ?? []) as Channel[])
        setSnapshots((m.data ?? []) as Snapshot[])
        if (rows.length) {
          const ids = rows.map(r => r.id)
          const [sc, sb, as, pj, ms, op] = await Promise.all([
            supabase.from('scripts').select('project_id,status').in('project_id', ids),
            supabase.from('storyboards').select('id,project_id').in('project_id', ids),
            supabase.from('assets').select('project_id').in('project_id', ids),
            supabase.from('publication_jobs').select('project_id,status').in('project_id', ids),
            supabase.from('metric_snapshots').select('project_id').in('project_id', ids),
            supabase.from('opportunities').select('project_id').in('project_id', ids),
          ])
          const boards = (sb.data ?? []) as Array<{ id: string; project_id: string }>
          const scenes = boards.length
            ? ((await supabase.from('scenes').select('storyboard_id,duration_ms').in('storyboard_id', boards.map(b => b.id))).data ?? []) as Array<{ storyboard_id: string; duration_ms: number }>
            : []
          const prog: Record<string, ProgressInput> = {}
          const dur: Record<string, number> = {}
          for (const id of ids) {
            const myBoards = boards.filter(b => b.project_id === id)
            const boardIds = new Set(myBoards.map(b => b.id))
            // Longest storyboard = planned duration of the video.
            const perBoard = myBoards.map(b => scenes.filter(s => s.storyboard_id === b.id).reduce((t, s) => t + s.duration_ms, 0))
            dur[id] = perBoard.length ? Math.max(...perBoard) / 1000 : 0
            prog[id] = {
              opportunities: (op.data ?? []).filter((r: { project_id: string }) => r.project_id === id).length,
              scripts: (sc.data ?? []).filter((r: { project_id: string }) => r.project_id === id).length,
              approvedScripts: (sc.data ?? []).filter((r: { project_id: string; status: string }) => r.project_id === id && r.status === 'approved').length,
              storyboards: myBoards.length,
              scenes: scenes.filter(s => boardIds.has(s.storyboard_id)).length,
              assets: (as.data ?? []).filter((r: { project_id: string }) => r.project_id === id).length,
              renders: 0,
              publications: (pj.data ?? []).filter((r: { project_id: string }) => r.project_id === id).length,
              metrics: (ms.data ?? []).filter((r: { project_id: string }) => r.project_id === id).length,
            }
          }
          setProgress(prog)
          setDurations(dur)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos del workspace.')
      }
    })()
  }, [])

  const latest = projects[0]
  const latestSteps = latest && progress[latest.id] ? projectProgress(progress[latest.id]) : null
  // Map the detailed pipeline onto the 6-step overview.
  const currentIndex = latestSteps ? overviewIndex(latestSteps) : 0
  const views = sumMetric(snapshots, 'views')
  const subs = sumMetric(snapshots, 'subscribersGained')
  const minutes = sumMetric(snapshots, 'estimatedMinutesWatched')
  const tiles = studioModules.filter(m => m.tile)

  return (
    <StudioShell>
      <section className="dashHero">
        <svg className="ridge" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 300 L0 190 L120 120 L210 170 L330 70 L430 150 L520 110 L640 200 L760 90 L860 40 L960 130 L1060 100 L1200 170 L1200 300Z" fill="#241c3a" opacity=".85" />
          <path d="M0 300 L0 240 L160 190 L300 230 L460 180 L600 240 L760 200 L900 230 L1040 190 L1200 230 L1200 300Z" fill="#120f1f" />
          <path d="M905 215 l6 -34 l4 0 l4 34 z M909 178 a5 5 0 1 0 0.1 0" fill="#0a0812" />
        </svg>
        <h1>Convierte tus ideas en vídeos que inspiran</h1>
        <p>Investiga, escribe, produce y distribuye desde un solo estudio. Nada se publica ni se paga sin tu aprobación.</p>
        <div className="heroActions">
          <Link className="buttonLink" href="/projects?new=1">Crear vídeo <Icon name="arrow" size={16} /></Link>
          <Link className="buttonLink ghost" href="/market-intelligence"><Icon name="search" size={16} /> Investigar un tema</Link>
        </div>
      </section>

      <nav className="tiles" aria-label="Herramientas">
        {tiles.map((m, i) => (
          <Link key={m.href} href={m.href} className="tile" title={`${moduleStateLabels[m.state]} · ${m.note}`}>
            <i className={`dot state-${m.state}`} aria-label={moduleStateLabels[m.state]} />
            <Icon name={m.icon} className={`t${i}`} />
            <b>{m.short}</b>
            <span>{moduleStateLabels[m.state]}</span>
          </Link>
        ))}
      </nav>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="dashRow">
        <section className="panel">
          <div className="cardHead">
            <h2>Tu flujo de creación</h2>
            {latest && <Link href={`/projects/${latest.id}`}>{latest.name} <Icon name="arrow" size={14} /></Link>}
          </div>
          <ol className="stepper" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {flow.map(([t, d], i) => (
              <li key={t} className={`step ${latest ? (i < currentIndex ? 'done' : i === currentIndex ? 'current' : '') : i === 0 ? 'current' : ''}`}>
                <i>{latest && i < currentIndex ? <Icon name="check" size={16} /> : i + 1}</i><b>{t}</b><span>{d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Rendimiento reciente</h2><span className="pill">Últimos 28 días</span></div>
          <div className="kpis">
            <div className="kpi"><Icon name="eye" /><b>{views ?? '—'}</b><span>Visualizaciones</span></div>
            <div className="kpi"><Icon name="plus" /><b>{subs ?? '—'}</b><span>Suscriptores</span></div>
            <div className="kpi"><Icon name="chart" /><b>{minutes != null ? `${Math.round(minutes / 60)} h` : '—'}</b><span>Tiempo de visualización</span></div>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            {snapshots.length ? `Datos observados · ${snapshots.length} registro(s).` : 'Sin datos observados todavía. Aparecerán al conectar YouTube Analytics; no se muestran cifras inventadas.'}
          </p>
        </section>
      </div>

      <div className="dashRow b">
        <section className="panel">
          <div className="cardHead"><h2>Proyectos recientes</h2><Link href="/projects">Ver todos <Icon name="arrow" size={14} /></Link></div>
          {signedIn === false ? (
            <div className="emptyState">Inicia sesión para ver tus proyectos. <Link className="open" href="/login?next=/">Iniciar sesión →</Link></div>
          ) : projects.length === 0 ? (
            <div className="emptyState">{signedIn === null ? 'Cargando…' : 'Todavía no hay proyectos.'}</div>
          ) : (
            <div className="projectCards">
              {projects.map(p => {
                const steps = progress[p.id] ? projectProgress(progress[p.id]) : null
                const nextStep = steps?.find(s => s.state === 'next')
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className="projectCard">
                    <div className="cover" style={{ background: coverFor(p.id) }}>
                      {p.name.trim().charAt(0).toUpperCase()}
                      {durations[p.id] > 0 && <em title="Duración planificada en el storyboard (estimación)">{formatDuration(durations[p.id])}</em>}
                    </div>
                    <h3>{p.name}</h3>
                    <p>{projectStatusLabel(p.status)}{nextStep ? ` · Siguiente: ${nextStep.label}` : ''}</p>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="cardHead"><h2>Publicación multicanal</h2><Link href="/connectors">Conexiones <Icon name="arrow" size={14} /></Link></div>
          <div className="channelList">
            {channels.map(ch => {
              const conn = connections.find(c => c.provider === ch.id)
              const connected = conn?.status === 'connected'
              return (
                <div className="channel" key={ch.id}>
                  <span className="logo" style={{ background: ch.color }}>{ch.letter}</span>
                  <div><b>{ch.name}</b><span>{connected ? conn?.external_account_name || 'Cuenta conectada' : 'Requiere OAuth'}</span></div>
                  <span className={connected ? 'pill ok' : 'pill'}>{connected ? 'Conectado' : 'No conectado'}</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="bottomRow">
        <section className="panel promo">
          <span className="bigIcon"><Icon name="link" /></span>
          <div><h3>Proveedores de IA</h3><p>Imágenes, vídeo y voz se activan con claves de servidor. Consulta qué está listo de verdad.</p></div>
          <Link className="buttonLink ghost small" href="/connectors">Ver estado</Link>
        </section>
        <section className="panel promo">
          <span className="bigIcon"><Icon name="bolt" /></span>
          <div><h3>Automatizaciones</h3><p>Todavía no implementadas. Las acciones sensibles quedarán siempre tras tu aprobación.</p></div>
          <Link className="buttonLink ghost small" href="/automations">Ver plan</Link>
        </section>
      </div>
    </StudioShell>
  )
}
