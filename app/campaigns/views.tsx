'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { MultiSelect } from '../components/multi-select'
import { COUNTRIES } from '@/lib/research/discovery'
import { fmtNumber } from '@/lib/research/format'
import { CURRENCIES, GOALS, METRICS, PLATFORMS, SUBJECTS } from '@/lib/campaigns/catalog'
import { NETWORKS, type Readiness } from '@/lib/campaigns/connections'
import { suggestPlatforms, assumptionFor, type Strategy } from '@/lib/campaigns/strategy'
import type { Brief, PlatformId } from '@/lib/campaigns/types'
import { NumField, SelectField, TextField } from './fields'

type P = { brief: Brief; set: (patch: Partial<Brief>) => void; strategy: Strategy }
const money = (n: number | null, cur: string) => (n === null ? '—' : `${fmtNumber(Math.round(n * 100) / 100)} ${cur}`)

function Question({ q, children }: { q: Strategy['questions'][number]; children: React.ReactNode }) {
  return <fieldset className="campaignQuestion" aria-label={`Pregunta ${q.n}: ${q.question}`}>
    <legend><span className={`qNum${q.done ? ' done' : ''}`}>{q.n}</span> {q.question}</legend>{children}<p className="muted small">{q.hint}</p></fieldset>
}

export function BriefTab({ brief, set, strategy }: P) {
  return <div>
    <p role="status" className="notice" style={{ margin: '0 0 14px' }}><b>{strategy.answered} de 9 preguntas respondidas.</b> Puedes dejar preguntas en blanco: la estrategia se calcula con lo que hay y te dice qué falta.</p>
    <TextField label="Nombre de la campaña" value={brief.name} onChange={name => set({ name })} placeholder="Ej.: Lanzamiento del canal en EE. UU." />
    <div className="campaignGrid">
      <Question q={strategy.questions[0]}><SelectField label="Tipo" value={brief.subject} onChange={subject => set({ subject })} options={SUBJECTS} empty="Elige…" />
        <TextField label="Nombre" value={brief.subjectName} onChange={subjectName => set({ subjectName })} placeholder="Nombre del vídeo, canal, producto o tienda" />
        <TextField label="Enlace (opcional)" value={brief.subjectUrl} onChange={subjectUrl => set({ subjectUrl })} placeholder="https://…" /></Question>
      <Question q={strategy.questions[1]}><SelectField label="Objetivo principal" value={brief.goal} onChange={goal => set({ goal })} options={GOALS.map(g => [g[0], g[1]] as [typeof g[0], string])} empty="Elige…" />
        {brief.goal && <p className="muted small">{GOALS.find(g => g[0] === brief.goal)?.[2]}</p>}</Question>
      <Question q={strategy.questions[2]}><MultiSelect label="Países o regiones" options={COUNTRIES.map(c => [c.code, c.name] as [string, string])} value={brief.countries} onChange={countries => set({ countries })} /></Question>
      <Question q={strategy.questions[3]}><div className="campaignRow"><NumField label="Edad mínima" value={brief.ageMin} onChange={ageMin => set({ ageMin })} min={13} max={65} /><NumField label="Edad máxima" value={brief.ageMax} onChange={ageMax => set({ ageMax })} min={13} max={65} /></div>
        <TextField label="Intereses (separados por comas)" value={brief.interests} onChange={interests => set({ interests })} placeholder="ciencia, curiosidades, divulgación" />
        <TextField label="Quién es y qué problema tiene" value={brief.audienceNotes} onChange={audienceNotes => set({ audienceNotes })} multiline /></Question>
      <Question q={strategy.questions[4]}><fieldset className="chips" aria-label="Plataformas">{PLATFORMS.map(p => <button key={p.id} type="button" className={`chip${brief.platforms.includes(p.id) ? ' active' : ''}`} aria-pressed={brief.platforms.includes(p.id)}
        onClick={() => set({ platforms: brief.platforms.includes(p.id) ? brief.platforms.filter(x => x !== p.id) : [...brief.platforms, p.id] })}>{p.label}</button>)}</fieldset>
        <button type="button" className="ghost" onClick={() => set({ platforms: suggestPlatforms(brief) })}>Usar plataformas sugeridas</button>
        <p className="muted small">Tipo de campaña: <b>{strategy.mode === 'mixed' ? 'mixta' : strategy.mode === 'paid' ? 'de pago' : strategy.mode === 'organic' ? 'orgánica' : 'sin definir'}</b>{brief.platforms.length === 0 && ' (según las sugeridas)'}</p></Question>
      <Question q={strategy.questions[5]}><SelectField label="Moneda" value={brief.currency} onChange={c => set({ currency: c ?? 'EUR' })} options={CURRENCIES.map(c => [c, c] as [typeof c, string])} empty="EUR" />
        <NumField label="Presupuesto total" value={brief.totalBudget} onChange={totalBudget => set({ totalBudget })} suffix={brief.currency} step={10} /></Question>
      <Question q={strategy.questions[6]}><NumField label="Presupuesto diario máximo" value={brief.dailyCap} onChange={dailyCap => set({ dailyCap })} suffix={brief.currency} step={1} /></Question>
      <Question q={strategy.questions[7]}><NumField label="Duración (días)" value={brief.durationDays} onChange={durationDays => set({ durationDays: durationDays === null ? null : Math.round(durationDays) })} min={1} max={365} />
        <TextField label="Fecha de inicio (AAAA-MM-DD, opcional)" value={brief.startDate} onChange={startDate => set({ startDate })} placeholder="2026-11-02" /></Question>
      <Question q={strategy.questions[8]}><SelectField label="Métrica" value={brief.expectedMetric} onChange={expectedMetric => set({ expectedMetric })} options={METRICS} empty="Elige…" />
        <NumField label="Cantidad esperada" value={brief.expectedValue} onChange={expectedValue => set({ expectedValue })} /></Question>
    </div>
    {strategy.suggestions.length > 0 && <section className="panel" aria-label="Recomendaciones para completar la estrategia"><h3>Para completar la estrategia</h3><ul>{strategy.suggestions.map(s => <li key={s}>{s}</li>)}</ul></section>}
  </div>
}

export function StrategyTab({ strategy, brief, set }: P) {
  const toggle = (id: PlatformId) => set({ platforms: (brief.platforms.length ? brief.platforms : strategy.platforms.filter(p => p.chosen).map(p => p.id)).includes(id) ? (brief.platforms.length ? brief.platforms : strategy.platforms.filter(p => p.chosen).map(p => p.id)).filter(x => x !== id) : [...(brief.platforms.length ? brief.platforms : strategy.platforms.filter(p => p.chosen).map(p => p.id)), id] })
  return <div>
    <p>{strategy.summary}</p>
    {strategy.warnings.map(w => <p key={w} className="error" role="alert">⚠ {w}</p>)}
    <h3 className="sectionTitle">Plataformas y por qué</h3>
    <p className="muted small">El encaje es un criterio editorial (1–5), no un estudio. Cambia la selección y todo se recalcula.</p>
    <div className="campaignGrid">{strategy.platforms.map(p => <article key={p.id} className={`platformCard${p.chosen ? ' chosen' : ''}`} aria-label={p.label}>
      <h4>{p.label} <span className="muted small">· {p.kind === 'paid' ? 'pago' : 'orgánico'}</span></h4>
      <ul className="small">{p.reasons.map(r => <li key={r}>{r}</li>)}</ul>
      <p className="muted small">Necesita: {p.needs}</p>
      <button type="button" className={p.chosen ? '' : 'ghost'} aria-pressed={p.chosen} onClick={() => toggle(p.id)}>{p.chosen ? 'En la campaña ✓' : 'Añadir a la campaña'}</button>
    </article>)}</div>
    <h3 className="sectionTitle">Público</h3>
    <p className="small">Edad: <b>{strategy.audience.demographics}</b>. Mercados: <b>{strategy.audience.markets.join('; ') || 'sin definir'}</b>.</p>
    <div className="campaignGrid">{strategy.audience.segments.map(s => <article key={s.name}><h4>{s.name}</h4><p className="small">{s.description}</p><p className="muted small">Requiere: {s.requires}</p></article>)}</div>
  </div>
}

export function ContentTab({ strategy }: { strategy: Strategy }) {
  return <div>
    <h3 className="sectionTitle">Plan de contenido y anuncios</h3>
    <table className="dataTable"><thead><tr><th>Plataforma</th><th>Pieza</th><th>Ritmo</th></tr></thead><tbody>{strategy.content.map(c => <tr key={c.platform + c.item}><td>{c.platform}</td><td>{c.item}</td><td>{c.cadence}</td></tr>)}</tbody></table>
    <p className="muted small">Los ritmos son orientativos (criterio editorial). Comprueba la especificación vigente de cada plataforma antes de exportar una pieza.</p>
    <h3 className="sectionTitle">Piezas creativas (se producen en el Estudio)</h3>
    <div className="campaignGrid">{strategy.creatives.map(c => <article key={c.title}><h4>{c.title}</h4><p className="small">{c.spec}</p><p className="muted small">{c.platforms.join(' · ')}</p><Link className="open" href={c.studioHref}>{c.studioLabel}</Link></article>)}</div>
  </div>
}

export function BudgetTab({ strategy, brief }: P) {
  const b = strategy.budget, c = b.currency
  return <div>
    <p>Total <b>{money(b.total, c)}</b> · máximo diario <b>{money(brief.dailyCap, c)}</b> · duración <b>{b.days ?? '—'} días</b>{b.daily !== null && <> · gasto medio <b>{money(b.daily, c)}/día</b></>}</p>
    {b.warnings.map(w => <p key={w} className="error" role="alert">⚠ {w}</p>)}
    {b.lines.length > 0 ? <>
      <h3 className="sectionTitle">Reparto por plataforma de pago</h3>
      <table className="dataTable" aria-label="Reparto del presupuesto"><thead><tr><th>Plataforma</th><th>Importe</th><th>% del total</th></tr></thead><tbody>
        {b.lines.map(l => <tr key={l.platform}><td>{l.label}</td><td>{money(l.amount, c)}</td><td>{l.pct} %</td></tr>)}
        <tr><td>Reserva</td><td>{money(b.reserve, c)}</td><td>10 %</td></tr></tbody></table>
      <h3 className="sectionTitle">Reparto por fase</h3>
      <table className="dataTable" aria-label="Presupuesto por fase"><thead><tr><th>Fase</th><th>Importe</th><th>%</th></tr></thead><tbody>{b.phases.map(p => <tr key={p.name}><td>{p.name}</td><td>{money(p.amount, c)}</td><td>{p.pct} %</td></tr>)}</tbody></table>
    </> : <p className="muted">Sin reparto todavía: indica un presupuesto total y al menos una plataforma de pago.</p>}
    <h3 className="sectionTitle">Calendario de ejecución</h3>
    <ol className="calendar">{strategy.calendar.map(p => <li key={p.name}><b>{p.name}</b> <span className="muted small">{p.fromDay < 1 ? 'semana previa' : `día ${p.fromDay}${p.toDay !== p.fromDay ? `–${p.toDay}` : ''}`}{p.from ? ` · ${p.from}${p.to && p.to !== p.from ? ` → ${p.to}` : ''}` : ''}</span><ul className="small">{p.tasks.map(t => <li key={t}>{t}</li>)}</ul></li>)}</ol>
  </div>
}

export function ResultsTab({ strategy, brief, set }: P) {
  const sc = strategy.scenarios
  const edit = (id: PlatformId, field: 'cpm' | 'ctr' | 'conversion', v: number | null) => {
    const prev = { ...(brief.assumptions[id] ?? {}) }; if (v === null) delete prev[field]; else prev[field] = v
    const next = { ...brief.assumptions, [id]: prev }; if (!Object.keys(prev).length) delete next[id]
    set({ assumptions: next })
  }
  return <div>
    <h3 className="sectionTitle">Indicadores de rendimiento</h3>
    <ul>{strategy.kpis.map(k => <li key={k.platform}><b>{k.platform}:</b> {k.kpis.join(', ')}</li>)}</ul>
    <h3 className="sectionTitle">Escenarios de resultados estimados</h3>
    {sc ? <>
      <p className="notice" role="note">Estimación con supuestos de ejemplo, <b>no con datos reales</b> de tus cuentas. Edítalos abajo con los de un piloto.</p>
      <table className="dataTable" aria-label="Escenarios"><thead><tr><th>Escenario</th><th>Gasto</th><th>Impresiones</th><th>Clics</th><th>{sc.metricLabel}</th><th>Coste por resultado</th><th>% del objetivo</th></tr></thead><tbody>
        {sc.scenarios.map(s => <tr key={s.name}><td>{s.name}</td><td>{money(s.spend, brief.currency)}</td><td>{fmtNumber(s.impressions)}</td><td>{fmtNumber(s.clicks)}</td><td>{fmtNumber(s.results)}</td><td>{money(s.costPerResult, brief.currency)}</td><td>{s.pctOfGoal === null ? '—' : `${s.pctOfGoal} %`}</td></tr>)}</tbody></table>
      <p className="muted small">{sc.note}</p>
      <h4>Supuestos editables</h4>
      <div className="campaignGrid">{sc.assumptions.map(a => { const id = a.id; const cur = assumptionFor(brief, id); return <article key={id}><b>{a.platform}</b>{a.custom && <span className="muted small"> · editado</span>}
        <NumField label={`CPM (${brief.currency} por 1.000 impresiones)`} value={cur.cpm} onChange={v => edit(id, 'cpm', v)} min={0.01} step={0.5} />
        <NumField label="CTR (0–1, p. ej. 0,01 = 1 %)" value={cur.ctr} onChange={v => edit(id, 'ctr', v)} min={0.0001} max={1} step={0.001} />
        <NumField label="Conversión de clic a resultado (0–1)" value={cur.conversion} onChange={v => edit(id, 'conversion', v)} min={0.0001} max={1} step={0.01} />
        {a.custom && <button type="button" className="ghost" onClick={() => set({ assumptions: Object.fromEntries(Object.entries(brief.assumptions).filter(([k]) => k !== id)) })}>Volver al ejemplo</button>}</article> })}</div>
    </> : <p className="muted">{strategy.scenarioNote}</p>}
    <h3 className="sectionTitle">Cuándo detener, optimizar o ampliar</h3>
    <div className="campaignGrid">{(['detener', 'optimizar', 'ampliar'] as const).map(k => <article key={k}><h4 style={{ textTransform: 'capitalize' }}>{k}</h4>{strategy.rules.filter(r => r.kind === k).map(r => <p key={r.when} className="small"><b>Si</b> {r.when}<br /><b>Entonces</b> {r.then}</p>)}</article>)}</div>
  </div>
}

export function ConnectionsTab({ brief }: { brief: Brief }) {
  const [ready, setReady] = useState<Readiness[] | null>(null), [err, setErr] = useState('')
  useEffect(() => { let off = false; fetch('/api/campaigns/connections', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error('No se pudo comprobar')))).then((j: { networks: Readiness[] }) => { if (!off) setReady(j.networks) }).catch(e => { if (!off) setErr(e instanceof Error ? e.message : 'Error') }); return () => { off = true } }, [])
  return <div>
    <p className="notice" role="note"><b>Ninguna conexión publicitaria está activa.</b> La campaña se puede diseñar, guardar y exportar sin ellas. Cerebro Studio no publica anuncios ni gasta presupuesto.</p>
    <div className="campaignGrid">{NETWORKS.map(n => { const r = ready?.find(x => x.network === n.network); const wanted = brief.platforms.includes(n.network)
      return <article key={n.network} aria-label={n.label}>
        <h4>{n.label} {wanted && <span className="muted small">· en esta campaña</span>}</h4>
        <p><span className="stateBadge state-not_implemented">No disponible</span></p>
        <p className="small">{r?.message ?? (err ? `Estado no comprobado (${err}).` : 'Comprobando…')}</p>
        <p className="small"><b>{n.api}</b> · {n.auth}</p>
        <ol className="small">{n.requirements.map(q => <li key={q.step}><b>{q.step}</b> ({q.who}): {q.detail}</li>)}</ol>
        <p className="small"><b>Plazo:</b> {n.approvalTime}</p>
        <ul className="small muted">{n.notes.map(x => <li key={x}>{x}</li>)}</ul>
        <a className="open" href={n.docs} target="_blank" rel="noreferrer">Documentación oficial</a>
      </article> })}</div>
  </div>
}
