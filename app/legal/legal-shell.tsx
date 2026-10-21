import Link from 'next/link'
import type { ReactNode } from 'react'

/** Public legal pages (no login), required by Google OAuth verification, Meta App Review and TikTok app review. */
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || ''
export const UPDATED = '21 de octubre de 2026 / October 21, 2026'

export function Contact() {
  return CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : <span>el correo de asistencia indicado en la pantalla de autorización / the support e-mail shown on the authorization screen</span>
}

export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px 64px', lineHeight: 1.6 }}>
    <p className="muted small"><Link href="/">Cerebro Studio</Link> · <Link href="/legal/privacidad">Privacidad / Privacy</Link> · <Link href="/legal/terminos">Términos / Terms</Link> · <Link href="/legal/eliminar-datos">Eliminar datos / Data deletion</Link></p>
    <h1>{title}</h1>
    <p className="muted small">Última actualización / Last updated: {UPDATED}</p>
    {children}
  </main>
}
