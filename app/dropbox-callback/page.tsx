'use client'

import { useEffect, useState } from 'react'

/** Landing page of Dropbox's consent window: hands the answer to the editor tab that opened it and closes itself. */
export default function DropboxCallback() {
  const [msg, setMsg] = useState('Conectando con Dropbox…')
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    window.opener?.postMessage({ type: 'dropbox-code', code: q.get('code'), state: q.get('state'), error: q.get('error') }, location.origin)
    setMsg(q.get('code') ? 'Listo. Puedes cerrar esta ventana.' : 'No se dio permiso a Dropbox. Puedes cerrar esta ventana.')
    setTimeout(() => window.close(), 400)
  }, [])
  return <main style={{ padding: 24, fontFamily: 'sans-serif' }}>{msg}</main>
}
