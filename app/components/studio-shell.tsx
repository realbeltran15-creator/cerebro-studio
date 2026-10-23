'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
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

/** expanded = icons and names; compact = icons only (names on hover); hidden = no sidebar. Remembered in this browser. */
export type SidebarMode = 'expanded' | 'compact' | 'hidden'
export const SIDEBAR_KEY = 'cerebro-sidebar'
export function readSidebarMode(): SidebarMode {
  try { const v = localStorage.getItem(SIDEBAR_KEY); return v === 'compact' || v === 'hidden' ? v : 'expanded' } catch { return 'expanded' }
}
export function writeSidebarMode(m: SidebarMode) {
  try { localStorage.setItem(SIDEBAR_KEY, m) } catch { /* private mode: only for this visit */ }
  window.dispatchEvent(new CustomEvent('cerebro-sidebar', { detail: m }))
}

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
  const [side, setSide] = useState<SidebarMode>('expanded')
  // The saved choice is read after the first paint (the server cannot know it) and follows changes made elsewhere (the editor's modes).
  useEffect(() => {
    const sync = () => setSide(readSidebarMode())
    sync()
    const on = (e: Event) => setSide((e as CustomEvent<SidebarMode>).detail)
    window.addEventListener('cerebro-sidebar', on)
    return () => window.removeEventListener('cerebro-sidebar', on)
  }, [])
  const setMode = (m: SidebarMode) => { setSide(m); writeSidebarMode(m) }
  const [query, setQuery] = useState('')
  const activeHref = studioModules.filter(m => isActive(pathname, m.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href

  function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    router.push(q ? `/projects?q=${encodeURIComponent(q)}` : '/projects')
  }

  return (
    <div className="studio" data-sidebar={side}>
      <header className="topbar">
        <button type="button" className="iconButton menuToggle" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <Icon name="menu" />
        </button>
        <button type="button" className="iconButton sideToggle" aria-label={side === 'expanded' ? 'Contraer la barra lateral' : 'Expandir la barra lateral'} title={side === 'expanded' ? 'Contraer la barra lateral (solo iconos)' : 'Expandir la barra lateral'}
          aria-pressed={side !== 'expanded'} onClick={() => setMode(side === 'expanded' ? 'compact' : 'expanded')}>
          <Icon name={side === 'expanded' ? 'collapse' : 'expand'} />
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

      <aside className={open ? 'sidebar open' : 'sidebar'} aria-label="Barra lateral">
        <nav aria-label="Módulos">
          {groupedModules().map(g => (
            <div key={g.id ?? 'top'} className="navGroup" role={g.id ? 'group' : undefined} aria-label={g.label || undefined}>
              {g.label && <small className="navGroupLabel">{g.label}</small>}
              {g.modules.map(m => (
                <Link key={m.href} href={m.href} className={m.href === activeHref ? 'navItem active' : 'navItem'} onClick={() => setOpen(false)}
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
        <div className="sideModes" role="group" aria-label="Barra lateral">
          {side === 'expanded'
            ? <button type="button" className="ghost small" onClick={() => setMode('compact')} title="Solo iconos"><Icon name="collapse" size={16} /><span>Contraer</span></button>
            : <button type="button" className="ghost small" onClick={() => setMode('expanded')} title="Iconos y nombres"><Icon name="expand" size={16} /><span>Expandir</span></button>}
          <button type="button" className="ghost small" onClick={() => setMode('hidden')} title="Ocultarla del todo (vuelve con el botón de arriba)"><Icon name="hide" size={16} /><span>Ocultar</span></button>
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
