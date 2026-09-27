'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { moduleFor, moduleStateLabels, studioModules, type ModuleState } from '@/lib/module-status'
import { Icon } from './studio-icon'

export { studioModules }

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function StateBadge({ state }: { state: ModuleState }) {
  return <span className={`stateBadge state-${state}`}>{moduleStateLabels[state]}</span>
}

export function StudioShell({ title, eyebrow = 'WORKSPACE', actions, children }: {
  title?: string
  eyebrow?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    router.push(q ? `/projects?q=${encodeURIComponent(q)}` : '/projects')
  }

  return (
    <div className="studio">
      <header className="topbar">
        <button type="button" className="iconButton menuToggle" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <Icon name="menu" />
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

      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <nav aria-label="Módulos">
          {studioModules.map(m => (
            <Link key={m.href} href={m.href} className={isActive(pathname, m.href) ? 'navItem active' : 'navItem'} onClick={() => setOpen(false)}
              title={`${moduleStateLabels[m.state]} · ${m.note}`}>
              <Icon name={m.icon} />
              <span>{m.label}</span>
              {m.state !== 'functional' && <i className={`dot state-${m.state}`} aria-label={moduleStateLabels[m.state]} />}
            </Link>
          ))}
        </nav>
        <div className="sideNote">
          <b>Acciones protegidas</b>
          <span>Publicar, gastar dinero o conectar cuentas siempre requiere tu aprobación explícita.</span>
        </div>
      </aside>
      {open && <button type="button" className="scrim" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}

      <main className="content">
        {title && (
          <div className="pageHead">
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
export function ModulePage({ title, description, steps, href }: { title: string; description: string; steps: string[]; href?: string }) {
  const pathname = usePathname() ?? ''
  const mod = moduleFor(href ?? pathname)
  const state = mod?.state ?? 'not_implemented'
  return (
    <StudioShell title={title} eyebrow="MÓDULO">
      <section className="panel moduleIntro">
        <div>
          <StateBadge state={state} />
          <h2>{title}</h2>
          <p>{description}</p>
          {mod?.note && <p className="muted">{mod.note}</p>}
        </div>
        <Link className="buttonLink ghost" href="/projects">Ir a proyectos <Icon name="arrow" size={16} /></Link>
      </section>
      <h3 className="sectionTitle">Flujo previsto</h3>
      <ol className="plannedSteps">
        {steps.map(step => <li key={step}>{step}</li>)}
      </ol>
      <p className="muted small">Este módulo todavía no guarda ni genera nada. Se mostrará como funcional solo cuando lo sea.</p>
    </StudioShell>
  )
}
