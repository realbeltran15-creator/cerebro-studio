'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { bibleIssues, parseBible, type PersonaBible } from '@/lib/virtual-influencer/bible'
import { Field, type Persona } from './shared'

const listFields: Array<[keyof PersonaBible, string, string]> = [
  ['languages', 'Idiomas', 'Uno por línea o separados por comas'],
  ['contentPillars', 'Pilares de contenido', 'Temas recurrentes'],
  ['catchphrases', 'Expresiones propias', ''],
  ['doList', 'Siempre hace', ''],
  ['dontList', 'Nunca hace ni dice', 'Límites obligatorios'],
]

export function BibleEditor({ persona, onSaved }: { persona: Persona; onSaved: () => void }) {
  const supabase = getSupabaseBrowserClient()
  const [b, setB] = useState<PersonaBible>(() => parseBible(persona.bible))
  const [lists, setLists] = useState<Record<string, string>>(() => Object.fromEntries(listFields.map(([k]) => [k, (parseBible(persona.bible)[k] as string[]).join('\n')])))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const current = parseBible({ ...b, ...Object.fromEntries(Object.entries(lists)) })
  const issues = bibleIssues(current)
  const set = (k: keyof PersonaBible, v: unknown) => setB(x => ({ ...x, [k]: v }))

  async function save() {
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('vi_personas').update({ bible: current, updated_at: new Date().toISOString() }).eq('id', persona.id)
    setBusy(false)
    if (error) setMsg({ ok: false, text: error.message }); else { setMsg({ ok: true, text: 'Persona Bible guardada.' }); onSaved() }
  }

  return <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h3>Persona Bible</h3>
    <Field label="Resumen"><textarea className="viText" value={b.summary} onChange={e => set('summary', e.target.value)} maxLength={600} /></Field>
    <div className="field-row">
      <Field label="Edad aparente (18+)"><input type="number" min={18} max={99} value={b.apparentAge ?? ''} onChange={e => set('apparentAge', e.target.value ? Number(e.target.value) : null)} /></Field>
      <Field label="Género"><input value={b.gender} onChange={e => set('gender', e.target.value)} maxLength={60} /></Field>
      <Field label="Nacionalidad / origen"><input value={b.nationality} onChange={e => set('nationality', e.target.value)} maxLength={80} /></Field>
    </div>
    <Field label="Personalidad"><textarea className="viText" value={b.personality} onChange={e => set('personality', e.target.value)} /></Field>
    <Field label="Historia de fondo"><textarea className="viText" value={b.backstory} onChange={e => set('backstory', e.target.value)} /></Field>
    <div className="field-row">
      <Field label="Valores"><textarea className="viText" value={b.values} onChange={e => set('values', e.target.value)} /></Field>
      <Field label="Tono"><textarea className="viText" value={b.tone} onChange={e => set('tone', e.target.value)} /></Field>
    </div>
    <div className="field-row">
      {listFields.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><textarea className="viText" value={lists[k]} onChange={e => setLists(l => ({ ...l, [k]: e.target.value }))} /></Field>)}
    </div>
    <p className="pill ok" style={{ alignSelf: 'flex-start' }}>Divulgación como IA: siempre activa</p>
    <label className="pill" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={b.originalLikenessConfirmed} onChange={e => set('originalLikenessConfirmed', e.target.checked)} /> Confirmo que el aspecto y la voz son originales y no imitan a una persona real identificable</label>
    {issues.length > 0 && <ul className="warnList">{issues.map(i => <li key={i.field}>{i.blocking ? '' : '(recomendado) '}{i.message}</li>)}</ul>}
    {msg && <p className={msg.ok ? 'notice' : 'error'} role="status">{msg.text}</p>}
    <div><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar Persona Bible'}</button></div>
  </section>
}
