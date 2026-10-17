/**
 * Session loss on the Preview. When the Vercel (or app) sign-in expires, a request to /api is answered with a redirect to a login page on ANOTHER
 * origin; the browser cannot follow it (no CORS) and only says «Failed to fetch». Requests are therefore made with `redirect: 'manual'` so the
 * redirect is visible, and it is reported as what it is: the request never reached the application, so YouTube was not queried and nothing is counted.
 */
export class SessionExpiredError extends Error {
  readonly where: 'vercel' | 'app'
  constructor(where: 'vercel' | 'app') {
    super(where === 'vercel'
      ? 'Tu sesión de Vercel (acceso a esta Preview) ha caducado y la solicitud nunca llegó a la aplicación. No se ha consultado YouTube ni se ha contado consumo. Recarga la página, vuelve a iniciar sesión y lanza la consulta de nuevo. No se reintentará automáticamente.'
      : 'Tu sesión de Cerebro Studio ha caducado: el servidor rechazó la solicitud antes de consultar YouTube. No se ha contado consumo. Vuelve a iniciar sesión (recarga la página) y lanza la consulta de nuevo. No se reintentará automáticamente.')
    this.name = 'SessionExpiredError'; this.where = where
  }
}

type Answer = Pick<Response, 'type' | 'status' | 'redirected' | 'url'> & { headers?: { get(name: string): string | null } }

/** Classifies an answer: null when it is an ordinary answer, otherwise which sign-in was lost. */
export function sessionLoss(r: Answer, origin?: string): 'vercel' | 'app' | null {
  if (r.type === 'opaqueredirect') return 'vercel'
  if (r.redirected && origin && r.url && !r.url.startsWith(origin)) return 'vercel'
  if (r.status === 401) return /text\/html/i.test(r.headers?.get('content-type') ?? '') ? 'vercel' : 'app'   // Vercel's protection answers 401 with a web page; the app answers JSON
  return null
}

/** fetch that never follows a redirect blindly and turns a lost sign-in into a clear, non-retryable error. */
export async function sessionFetch(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const r = await fetcher(url, { ...init, redirect: 'manual' })
  const lost = sessionLoss(r, typeof location !== 'undefined' ? location.origin : undefined)
  if (lost) throw new SessionExpiredError(lost)
  return r
}
