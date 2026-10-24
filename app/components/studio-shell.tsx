'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { groupedModules, moduleFor, moduleStateLabels, studioModules, type ModuleState } from '@/lib/module-status'
import { Icon } from './studio-icon'

export { studioModules }

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function StateBadge({ state }: { state: ModuleState }) {
  return <span className={`stateBadge state-${state}`}>{moduleStateLabels[state]}</span>
}

/**
 * pinned = always open (icons and names); auto = a thin icon rail that opens over the page while the pointer or the keyboard is on it
 * and closes by itself shortly after; hidden = no sidebar at all, only a small button at the left edge. Remembered in this browser.
 */
export type SidebarMode = 'pinned' | 'auto' | 'hidden'
export const SIDEBAR_KEY = 'cerebro-sidebar'
export const SIDEBAR_LABELS: Record<SidebarMode, string> = { pinned: 'Fija', auto: 'Automática', hidden: 'Oculta' }
export function readSidebarMode(): SidebarMode {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY)
    // Older names of the same choices.
    return v === 'auto' || v === 'compact' ? 'auto' : v === 'hidden' ? 'hidden' : 'pinned'
  } catch { return 'pinned' }
}
export function writeSidebarMode(m: SidebarMode) {
  try { localStorage.setItem(SIDEBAR_KEY, m) } catch { /* private mode: only for this visit */ }
  window.dispatchEvent(new CustomEvent('cerebro-sidebar', { detail: m }))
}
const OPEN_DELAY = 90, CLOSE_DELAY = 450

export function StudioShell({ title, eyebrow = 'WORKSPACE', actions, children, wide = false, compactHead = false }: {
  title?: string
  eyebrow?: string
  actions?: React.ReactNode
  children: React.ReactNode
  /** Use the whole width (editors): no maximum content width. */
  wide?: boolean
  /** A one-line page header (editors), to leave the height to the work area. */
  compactHead?: boolean
}) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<SidebarMode>('pinned')
  // Temporarily open over the page (modes «auto» and «hidden»).
  const [peek, setPeek] = useState(false)
  const timer = useRef<number | null>(null)
  const asideRef = useRef<HTMLElement | null>(null)
  const later = (fn: () => void, ms: number) => { if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(fn, ms) }
  // Never close while the keyboard focus or an open menu is inside the sidebar.
  // (Focus left by a mouse click does not count; keyboard focus does.) Opened with the button, it stays until the pointer has been inside.
  const byButton = useRef(false)
  // On a touch screen the first tap on the closed rail only opens it (it must not follow the link under the finger).
  const tapOpened = useRef(false)
  const busyInside = () => { const el = asideRef.current; return byButton.current || (!!el && (!!el.querySelector(':focus-visible') || !!el.querySelector('details[open], [aria-expanded="true"]'))) }
  const openPeek = (now = false) => { if (side === 'pinned') return; if (now) { if (timer.current) window.clearTimeout(timer.current); setPeek(true) } else later(() => setPeek(true), OPEN_DELAY) }
  const closePeek = (now = false) => { if (now) { if (timer.current) window.clearTimeout(timer.current); byButton.current = false; setPeek(false) } else later(() => { if (!busyInside()) setPeek(false) }, CLOSE_DELAY) }
  // A tap or click outside closes it (touch screens have no «pointer leaves»); Escape too.
  useEffect(() => {
    if (!peek) return
    const down = (e: PointerEvent) => { const t = e.target as Node; if (asideRef.current?.contains(t) || (t as HTMLElement).closest?.('.sideToggle,.sideEdge')) return; closePeek(true) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { closePeek(true); (document.querySelector('.sideToggle') as HTMLElement | null)?.focus() } }
    document.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key) }
  }, [peek]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  // The saved choice is read after the first paint (the server cannot know it) and follows changes made elsewhere (the editor's modes).
  useEffect(() => {
    const sync = () => setSide(readSidebarMode())
    sync()
    const on = (e: Event) => setSide((e as CustomEvent<SidebarMode>).detail)
    window.addEventListener('cerebro-sidebar', on)
    return () => window.removeEventListener('cerebro-sidebar', on)
  }, [])
  const setMode = (m: SidebarMode) => { setSide(m); setPeek(false); writeSidebarMode(m) }
  const toggleSide = () => { if (side === 'pinned') setMode('hidden'); else if (peek) closePeek(true); else { byButton.current = true; openPeek(true); window.setTimeout(() => (asideRef.current?.querySelector('a,button') as HTMLElement | null)?.focus(), 30) } }
  const [query, setQuery] = useState('')
  const activeHref = studioModules.filter(m => isActive(pathname, m.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href

  function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    router.push(q ? `/projects?q=${encodeURIComponent(q)}` : '/projects')
  }

  return (
    <div className="studio" data-sidebar={side} data-peek={peek && side !== 'pinned' ? 'on' : undefined}>
      <header className="topbar">
        <button type="button" className="iconButton menuToggle" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <Icon name="menu" />
        </button>
        <button type="button" className="iconButton sideToggle" aria-controls="studio-sidebar" aria-expanded={side === 'pinned' || peek}
          aria-label={side === 'pinned' ? 'Ocultar la barra lateral' : peek ? 'Cerrar la barra lateral' : 'Mostrar la barra lateral'}
          title={side === 'pinned' ? 'Ocultar la barra lateral' : 'Mostrar la barra lateral (fíjala con la chincheta)'} onClick={toggleSide}>
          <Icon name={side === 'pinned' || peek ? 'collapse' : 'expand'} />
        </button>
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brandMark" aria-hidden="true" />
          <span className="brandText"><b>Cerebro Studio</b><small>IDEA · CREA · EDITA · PUBLICA · CRECE</small></span>
        </Link>
        <form className="topSearch" onSubmit={search} role="search">
          <Icon name="search" size={16} />
          <input id="global-search" aria-label="Buscar proyectos" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar proyectos…" />
        </form>
        <Link className="buttonLink primary" href="/projects?new=1"><Icon name="plus" size={16} /><span>Nuevo proyecto</span></Link>
      </header>

      {side === 'hidden' && !peek && <button type="button" className="sideEdge" aria-label="Mostrar la barra lateral" title="Mostrar la barra lateral" onClick={toggleSide}
        onPointerEnter={e => { if (e.pointerType === 'mouse') openPeek() }} onPointerLeave={e => { if (e.pointerType === 'mouse') closePeek() }}><Icon name="expand" size={16} /></button>}
      <aside id="studio-sidebar" ref={asideRef} className={open ? 'sidebar open' : 'sidebar'} aria-label="Barra lateral"
        onPointerEnter={e => { byButton.current = false; if (side === 'auto' && e.pointerType === 'mouse') openPeek() }}
        onPointerLeave={e => { if (side !== 'pinned' && e.pointerType === 'mouse') closePeek() }}
        onPointerDown={e => { if (side === 'auto' && e.pointerType !== 'mouse' && !peek) { tapOpened.current = true; openPeek(true) } }}
        onClickCapture={e => { if (tapOpened.current) { tapOpened.current = false; e.preventDefault(); e.stopPropagation() } }}
        onFocus={e => { if (side !== 'pinned' && (e.target as HTMLElement).matches(':focus-visible')) openPeek(true) }}
        onBlur={e => { if (side !== 'pinned' && !e.currentTarget.contains(e.relatedTarget as Node | null)) closePeek() }}>
        <div className="sideHead">
          <button type="button" className={side === 'pinned' ? 'iconButton sidePin on' : 'iconButton sidePin'} aria-pressed={side === 'pinned'}
            aria-label={side === 'pinned' ? 'Desfijar la barra lateral (pasa a automática)' : 'Fijar la barra lateral'} title={side === 'pinned' ? 'Desfijar: se ocultará sola cuando no la uses' : 'Fijar: se queda abierta'}
            onClick={() => setMode(side === 'pinned' ? 'auto' : 'pinned')}><Icon name="pin" size={16} /></button>
          <div className="sideModes" role="radiogroup" aria-label="Comportamiento de la barra lateral">
            {(['pinned', 'auto', 'hidden'] as SidebarMode[]).map(m => <button key={m} type="button" role="radio" aria-checked={side === m} aria-label={SIDEBAR_LABELS[m]} className={side === m ? 'small' : 'ghost small'}
              title={m === 'pinned' ? 'Siempre abierta' : m === 'auto' ? 'Solo iconos; se abre al acercar el ratón y se cierra sola' : 'Sin barra; vuelve con el botón del borde izquierdo'}
              onClick={() => setMode(m)}><Icon name={m === 'pinned' ? 'pin' : m === 'auto' ? 'auto' : 'hide'} size={14} /><span>{SIDEBAR_LABELS[m]}</span></button>)}
          </div>
        </div>
        <nav aria-label="Módulos">
          {groupedModules().map(g => (
            <div key={g.id ?? 'top'} className="navGroup" role={g.id ? 'group' : undefined} aria-label={g.label || undefined}>
              {g.label && <small className="navGroupLabel">{g.label}</small>}
              {g.modules.map(m => (
                <Link key={m.href} href={m.href} className={m.href === activeHref ? 'navItem active' : 'navItem'} onClick={() => { setOpen(false); if (side !== 'pinned') closePeek(true) }}
                  aria-current={m.href === activeHref ? 'page' : undefined} title={`${m.label} — ${moduleStateLabels[m.state]} · ${m.note}`}>
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                  {m.state !== 'functional' && <i className={`dot state-${m.state}`} aria-label={moduleStateLabels[m.state]} />}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sideNote">
          <b>Acciones protegidas</b>
          <span>Publicar, gastar dinero o conectar cuentas siempre requiere tu aprobación explícita.</span>
        </div>
      </aside>
      {open && <button type="button" className="scrim" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}

      <main className={`content${wide ? ' wide' : ''}`}>
        {title && (
          <div className={`pageHead${compactHead ? ' compact' : ''}`}>
            <div><small>{eyebrow}</small><h1>{title}</h1></div>
            {actions && <div className="pageActions">{actions}</div>}
          </div>
        )}
        {children}
      </main>
    </div>
  )
}

/** Placeholder for modules that are not built yet. Reads the real state from lib/module-status. */
