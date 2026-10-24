'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * The editor's workspace: which panels are open, their sizes, the tool tab on the left, which property groups are open,
 * and the workspace mode. Remembered in this browser (it is a layout preference, not part of the montage).
 */
export type ToolTab = 'materials' | 'transitions' | 'effects' | 'texts' | 'audio' | 'ai'
export type WorkspaceMode = 'edit' | 'audio' | 'effects' | 'wide'
export type Layout = {
  left: boolean; right: boolean
  leftW: number; rightW: number
  /** Height of the viewer area in px (the timeline gets the rest). */
  viewerH: number
  /** The viewer height follows the screen (fits the timeline below it) until the owner drags it. */
  viewerAuto: boolean
  tab: ToolTab
  mode: WorkspaceMode
  /** Property groups and their open state (absent = its default). */
  sections: Record<string, boolean>
}
export const DEFAULT_LAYOUT: Layout = { left: true, right: true, leftW: 280, rightW: 340, viewerH: 460, viewerAuto: true, tab: 'materials', mode: 'edit', sections: {} }
export const LAYOUT_KEY = 'cerebro-editor-layout'
export const TOOL_TABS: Record<ToolTab, string> = { materials: 'Materiales', transitions: 'Transiciones', effects: 'Efectos', texts: 'Textos', audio: 'Audio', ai: 'IA' }
export const MODES: Record<WorkspaceMode, { label: string; hint: string }> = {
  edit: { label: 'Edición', hint: 'Visor y línea de tiempo grandes, materiales y propiedades a los lados' },
  audio: { label: 'Audio', hint: 'Mezclador y pistas a la vista; visor más pequeño' },
  effects: { label: 'Efectos', hint: 'Visor y propiedades amplias, pestaña de efectos' },
  wide: { label: 'Pantalla amplia', hint: 'Oculta los paneles laterales y la barra lateral para editar con todo el espacio' },
}
const clampN = (n: unknown, lo: number, hi: number, d: number) => { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d }

export function readLayout(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<Layout> | null
    // First visit: a viewer that leaves room for the timeline on this screen.
    if (!v || typeof v !== 'object') return { ...DEFAULT_LAYOUT, viewerH: Math.round(Math.min(560, Math.max(220, window.innerHeight * 0.36))) }
    return {
      left: v.left !== false, right: v.right !== false,
      leftW: clampN(v.leftW, 200, 640, DEFAULT_LAYOUT.leftW), rightW: clampN(v.rightW, 240, 640, DEFAULT_LAYOUT.rightW),
      viewerH: clampN(v.viewerH, 180, 1400, DEFAULT_LAYOUT.viewerH), viewerAuto: v.viewerAuto !== false,
      tab: v.tab && v.tab in TOOL_TABS ? v.tab : 'materials',
      mode: v.mode && v.mode in MODES ? v.mode : 'edit',
      sections: v.sections && typeof v.sections === 'object' ? Object.fromEntries(Object.entries(v.sections).filter(([, b]) => typeof b === 'boolean')) : {},
    }
  } catch { return DEFAULT_LAYOUT }
}

export type WorkspaceCtx = {
  layout: Layout
  set: (p: Partial<Layout>) => void
  isOpen: (id: string, def: boolean) => boolean
  toggle: (id: string, def: boolean) => void
  /** Opens the tab / group and scrolls to it (tool search). */
  reveal: (where: { tab?: ToolTab; section?: string; right?: boolean; selector?: string }) => void
}
const LayoutContext = createContext<WorkspaceCtx | null>(null)
export const useWorkspace = () => useContext(LayoutContext)!

/** The workspace state (kept by the editor page, shared below it with <WorkspaceProvider>). */
export function useWorkspaceState(): WorkspaceCtx {
  const [layout, setLayout] = useState<Layout>(() => (typeof window === 'undefined' ? DEFAULT_LAYOUT : readLayout()))
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* only for this visit */ } }, [layout])
  const set = useCallback((p: Partial<Layout>) => setLayout(l => ({ ...l, ...p })), [])
  const isOpen = useCallback((id: string, def: boolean) => layout.sections[id] ?? def, [layout.sections])
  const toggle = useCallback((id: string, def: boolean) => setLayout(l => ({ ...l, sections: { ...l.sections, [id]: !(l.sections[id] ?? def) } })), [])
  const pending = useRef<string | null>(null)
  const reveal = useCallback((w: { tab?: ToolTab; section?: string; right?: boolean; selector?: string }) => {
    setLayout(l => ({ ...l, ...(w.tab ? { tab: w.tab, left: true } : {}), ...(w.section || w.right ? { right: true } : {}), ...(w.section ? { sections: { ...l.sections, [w.section]: true } } : {}) }))
    pending.current = w.selector ?? (w.section ? `[data-section="${w.section}"]` : w.tab ? `[data-tabpanel="${w.tab}"]` : null)
    // After the panel opens: bring it into view and highlight it briefly.
    setTimeout(() => {
      const el = pending.current ? document.querySelector(pending.current) as HTMLElement | null : null
      if (!el) return
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      el.classList.add('flashFound'); setTimeout(() => el.classList.remove('flashFound'), 1400)
      const focusable = el.querySelector('input,select,button,textarea') as HTMLElement | null
      focusable?.focus({ preventScroll: true })
    }, 60)
  }, [])
  return useMemo(() => ({ layout, set, isOpen, toggle, reveal }), [layout, set, isOpen, toggle, reveal])
}
export function WorkspaceProvider({ value, children }: { value: WorkspaceCtx; children: ReactNode }) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

/** A collapsible group of properties (one click to open or close; its state is remembered). */
export function Section({ id, title, defaultOpen = false, children, extra }: { id: string; title: string; defaultOpen?: boolean; children: ReactNode; extra?: ReactNode }) {
  const w = useWorkspace()
  const open = w.isOpen(id, defaultOpen)
  const bodyId = `sec-${id}`
  return <section className={`edSection${open ? ' open' : ''}`} data-section={id} aria-label={title}>
    <button type="button" className="edSectionHead" aria-expanded={open} aria-controls={bodyId} onClick={() => w.toggle(id, defaultOpen)}>
      <span className="edChevron" aria-hidden>{open ? '▾' : '▸'}</span><span>{title}</span>{extra ? <span className="edSectionExtra">{extra}</span> : null}
    </button>
    <div id={bodyId} className="edSectionBody" hidden={!open}>{children}</div>
  </section>
}

/** The tool tabs on the left: only the chosen tab's tools are shown; the others stay mounted (nothing typed is lost). */
export function ToolTabs({ panels }: { panels: Record<ToolTab, ReactNode> }) {
  const w = useWorkspace()
  const tabs = Object.keys(TOOL_TABS) as ToolTab[]
  const move = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null) return
    e.preventDefault()
    const t = tabs[(n + tabs.length) % tabs.length]
    w.set({ tab: t })
    ;(document.getElementById(`tooltab-${t}`) as HTMLElement | null)?.focus()
  }
  return <>
    <div className="edTabs" role="tablist" aria-label="Herramientas">
      {tabs.map((t, i) => <button key={t} id={`tooltab-${t}`} type="button" role="tab" aria-selected={w.layout.tab === t} aria-controls={`toolpanel-${t}`} tabIndex={w.layout.tab === t ? 0 : -1}
        className={w.layout.tab === t ? 'edTab active' : 'edTab'} onClick={() => w.set({ tab: t })} onKeyDown={e => move(e, i)}>{TOOL_TABS[t]}</button>)}
    </div>
    {tabs.map(t => <div key={t} id={`toolpanel-${t}`} role="tabpanel" aria-labelledby={`tooltab-${t}`} data-tabpanel={t} hidden={w.layout.tab !== t} className="edTabPanel">{panels[t]}</div>)}
  </>
}

export type ToolEntry = { label: string; words: string; go: () => void }
/** «Buscar herramienta»: type a word (transición, volumen, recortar, subtítulos, zoom, exportar…) and jump to that tool. */
export function ToolSearch({ entries }: { entries: ToolEntry[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const hits = q.trim() ? entries.filter(e => fold(`${e.label} ${e.words}`).includes(fold(q.trim()))).slice(0, 8) : []
  const pick = (e: ToolEntry) => { e.go(); setQ(''); setOpen(false) }
  return <div className="toolSearch" role="search">
    <input type="search" aria-label="Buscar herramienta" placeholder="Buscar herramienta… (Ctrl+K)" value={q} id="tool-search"
      role="combobox" aria-expanded={open && hits.length > 0} aria-controls="tool-search-list" aria-autocomplete="list"
      onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
        if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]) }
        if (e.key === 'Escape') { setQ(''); setOpen(false) }
      }} />
    {open && hits.length > 0 && <ul id="tool-search-list" role="listbox" className="toolSearchList" aria-label="Herramientas encontradas">
      {hits.map((h, i) => <li key={h.label} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined} onMouseDown={e => { e.preventDefault(); pick(h) }}>{h.label}</li>)}
    </ul>}
    {open && q.trim() && !hits.length && <p className="toolSearchList muted small" role="status">Nada con «{q}».</p>}
  </div>
}

/** A drag handle between two areas (keyboard: arrows). */
export function Splitter({ label, orientation, value, min, max, onChange, invert = false, onReset, title }: { label: string; orientation: 'vertical' | 'horizontal'; value: number; min: number; max: number; onChange: (v: number) => void; invert?: boolean; onReset?: () => void; title?: string }) {
  const start = useRef<{ p: number; v: number } | null>(null)
  const pos = (e: React.PointerEvent) => (orientation === 'vertical' ? e.clientX : e.clientY)
  return <div className={`edSplit ${orientation}`} role="separator" aria-orientation={orientation} aria-label={label} tabIndex={0} title={title} onDoubleClick={onReset} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={max}
    onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); start.current = { p: pos(e), v: value } }}
    onPointerMove={e => { const s = start.current; if (!s) return; const d = (pos(e) - s.p) * (invert ? -1 : 1); onChange(Math.round(Math.min(max, Math.max(min, s.v + d)))) }}
    onPointerUp={() => { start.current = null }}
    onKeyDown={e => {
      const step = e.shiftKey ? 60 : 20
      const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp', fwd = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
      if (e.key === back || e.key === fwd) { e.preventDefault(); e.stopPropagation(); const d = (e.key === fwd ? step : -step) * (invert ? -1 : 1); onChange(Math.min(max, Math.max(min, value + d))) }
    }} />
}

export type MenuItem = { label: string; hint?: string; disabled?: boolean; run: () => void } | 'sep'
/** A right-click menu (also opens with the context-menu key or Mayús+F10). Arrows move, Enter runs, Escape or a click outside closes. */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Keep it on screen.
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`
    ;(el.querySelector('[role=menuitem]:not([disabled])') as HTMLElement | null)?.focus()
    const down = (e: PointerEvent) => { if (!el.contains(e.target as Node)) onClose() }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [onClose])
  const move = (e: React.KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll('[role=menuitem]:not([disabled])') ?? [])] as HTMLElement[]
    const i = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose() }
  }
  return <div ref={ref} className="ctxMenu" role="menu" aria-label={label} style={{ position: 'fixed', left: x, top: y, zIndex: 80 }} onKeyDown={move} onContextMenu={e => e.preventDefault()}>
    {items.map((it, i) => it === 'sep' ? <hr key={i} /> : <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.run() }}>
      <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
    </button>)}
  </div>
}
