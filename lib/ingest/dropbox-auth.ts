/**
 * Dropbox sign-in from the browser (OAuth code flow with PKCE: no app secret is needed or stored). The access token lives only in
 * memory for this export. It needs the App key of an app registered at dropbox.com/developers (free, «App folder» access,
 * permission files.content.write) in NEXT_PUBLIC_DROPBOX_APP_KEY; without it the option stays disabled.
 */
export const dropboxAppKey = () => (process.env.NEXT_PUBLIC_DROPBOX_APP_KEY ?? '').trim() || null
export const DROPBOX_REDIRECT_PATH = '/dropbox-callback'

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

export const dropboxAuthorizeUrl = (appKey: string, redirectUri: string, challenge: string, state: string) =>
  `https://www.dropbox.com/oauth2/authorize?${new URLSearchParams({ client_id: appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirectUri, state, token_access_type: 'online', scope: 'files.content.write' })}`

/** Opens Dropbox's consent window and returns an access token (kept in memory only). Must be called from a click. */
export async function connectDropbox(): Promise<string> {
  const key = dropboxAppKey()
  if (!key) throw new Error('Dropbox no está configurado: falta la App key (NEXT_PUBLIC_DROPBOX_APP_KEY).')
  const redirect = `${location.origin}${DROPBOX_REDIRECT_PATH}`
  const { verifier, challenge } = await pkcePair()
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const win = window.open(dropboxAuthorizeUrl(key, redirect, challenge, state), 'dropbox-connect', 'width=520,height=700')
  if (!win) throw new Error('El navegador bloqueó la ventana de Dropbox. Permite las ventanas emergentes e inténtalo de nuevo.')
  const code = await new Promise<string>((resolve, reject) => {
    const done = (fn: () => void) => { window.removeEventListener('message', onMsg); clearInterval(poll); fn() }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'dropbox-code') return
      if (e.data.state !== state) return done(() => reject(new Error('La respuesta de Dropbox no coincide con la petición.')))
      if (e.data.error || !e.data.code) return done(() => reject(new Error('No diste permiso a Dropbox.')))
      done(() => resolve(String(e.data.code)))
    }
    const poll = setInterval(() => { if (win.closed) done(() => reject(new Error('Cerraste la ventana de Dropbox sin dar permiso.'))) }, 600)
    window.addEventListener('message', onMsg)
  })
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: key, redirect_uri: redirect, code_verifier: verifier }) })
  if (!r.ok) throw new Error(`Dropbox no entregó el permiso (error ${r.status}).`)
  const j = await r.json() as { access_token?: string }
  if (!j.access_token) throw new Error('Dropbox no entregó el permiso.')
  return j.access_token
}
