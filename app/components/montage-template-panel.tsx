'use client'

import Link from 'next/link'
import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Composition } from '@/lib/editor/composition'
import { loadTemplates, makeTemplate, MAX_TEMPLATES, saveTemplates } from '@/lib/editor/montage-template'

/** «Guardar como plantilla de montaje»: keeps this montage's whole structure with its files replaced by slots. */
export function MontageTemplatePanel({ composition, typeOf }: { composition: Composition; typeOf: (assetId: string) => string }) {
  const supabase = getSupabaseBrowserClient()
  const [name, setName] = useState(composition.title || 'Mi plantilla')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const { templates, updatedAt } = await loadTemplates(supabase)
      if (templates.length >= MAX_TEMPLATES) throw new Error(`Puedes guardar hasta ${MAX_TEMPLATES} plantillas; borra alguna en Plantillas de montaje.`)
      if (templates.some(t => t.name.toLowerCase() === name.trim().toLowerCase())) throw new Error(`Ya tienes una plantilla «${name.trim()}».`)
      const t = makeTemplate(composition, name, typeOf)
      await saveTemplates(supabase, [t, ...templates], updatedAt)
      setMsg(`Plantilla «${t.name}» guardada: ${t.clips} clips, ${t.slots.length} huecos para archivos (${t.slots.map(s => s.label).join(', ')}).`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setBusy(false) }
  }

  return <section className="panel" aria-label="Plantilla de montaje" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
    <div className="cardHead" style={{ marginBottom: 0 }}><h3>Plantilla de montaje</h3><Link className="open small" href="/editor/templates">Mis plantillas →</Link></div>
    <p className="muted small">Guarda la estructura completa de este montaje (pistas, duraciones, transiciones, cámara, títulos, efectos y volúmenes). Cada archivo se convierte en un hueco que rellenas con otros materiales para montar otro vídeo igual.</p>
    <div className="field-row" style={{ alignItems: 'end' }}>
      <label>Nombre<input aria-label="Nombre de la plantilla" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <button type="button" disabled={busy || !composition.clips.length || !name.trim()} onClick={() => void save()}>Guardar como plantilla</button>
    </div>
    {err && <p className="error small" role="alert">{err}</p>}
    {msg && <p className="notice small" role="status">{msg}</p>}
  </section>
}
