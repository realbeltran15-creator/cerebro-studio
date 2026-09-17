'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/projects'
  return value
}

export default function LoginPage() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('Inicia sesión para acceder a los datos protegidos de Cerebro Studio.')
  const [busy, setBusy] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      window.location.href = safeNextPath(searchParams.get('next'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="projectsPage">
      <section className="projectsPanel authPanel">
        <Link className="backLink" href="/">← Centro de operaciones</Link>
        <small>ACCESO SEGURO</small>
        <h1>Iniciar sesión</h1>
        <p className="connectionStatus">{message}</p>
        <form className="authForm" onSubmit={signIn}>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo electrónico" />
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
          <button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="authNote">Cerebro Studio no guarda tu contraseña. La autenticación la gestiona Supabase.</p>
      </section>
    </main>
  )
}
