/** Cuándo interceptar una navegación interna del editor para no perder cambios que no están en la nube. */
export function unsavedAtRisk(s: { dirty: boolean; autoSave: boolean; saveState: 'saved' | 'pending' | 'saving' | 'error' | 'conflict' }): boolean {
  if (!s.dirty) return false
  return !s.autoSave || s.saveState === 'error' || s.saveState === 'conflict'
}

export type ClickInfo = { href: string | null; target: string | null; download: boolean; button: number; meta: boolean; origin: string; currentUrl: string }

/** Devuelve la ruta interna a la que iría el clic, o null si no es una navegación interna que cambie de página. */
export function internalNavTarget(c: ClickInfo): string | null {
  if (!c.href || c.button !== 0 || c.meta || c.download || (c.target && c.target !== '_self')) return null
  let url: URL
  try { url = new URL(c.href, c.currentUrl) } catch { return null }
  if (url.origin !== c.origin) return null
  const cur = new URL(c.currentUrl)
  if (url.pathname === cur.pathname && url.search === cur.search) return null
  return url.pathname + url.search + url.hash
}
