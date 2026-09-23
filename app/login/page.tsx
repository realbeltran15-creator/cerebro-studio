'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase/client'

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/projects'
  return value
}

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('Inicia sesión para acceder a los datos protegidos de Cerebro Studio.')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const supabase = createClient()
      const normalizedEmail = email.trim()
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: new URL('/login', window.location.origin).toString() },
        })
        if (error) throw error
        if (!data.session) {
          setMessage('Revisa tu correo y confirma tu cuenta. Después vuelve aquí e inicia sesión. Si no recibes el mensaje, revisa Spam.')
          return
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        if (error) throw error
      }
      window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get('next')))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la autenticación.')
    } finally {
      setBusy(false)
    }
  }

  function changeMode(nextMode: 'login' | 'signup') {
    setMode(nextMode)
    setMessage(nextMode === 'signup'
      ? 'Crea una cuenta de Cerebro Studio. Puede que tengas que confirmar tu correo electrónico.'
      : 'Inicia sesión para acceder a los datos protegidos de Cerebro Studio.')
  }

  return (
    <main className="projectsPage">
      <section className="projectsPanel authPanel">
        <Link className="backLink" href="/">← Centro de operaciones</Link>
        <small>ACCESO SEGURO</small>
        <h1>{mode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
        <p className="connectionStatus" role="status">{message}</p>
        <form className="authForm" onSubmit={submit}>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo electrónico" />
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 6 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
          <button disabled={busy}>{busy ? 'Procesando…' : mode === 'signup' ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
        <p className="authNote">{mode === 'signup' ? '¿Ya tienes una cuenta?' : '¿Todavía no tienes una cuenta?'}{' '}
          <button type="button" className="authModeButton" disabled={busy} onClick={() => changeMode(mode === 'signup' ? 'login' : 'signup')}>
            {mode === 'signup' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </p>
        <p className="authNote">Cerebro Studio no guarda tu contraseña. La autenticación la gestiona Supabase.</p>
      </section>
    </main>
  )
}
