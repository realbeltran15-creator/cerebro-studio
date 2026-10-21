import type { Metadata } from 'next'
import { Contact, LegalShell } from '../legal-shell'

export const metadata: Metadata = { title: 'Eliminación de datos · Cerebro Studio', description: 'Cómo eliminar tus datos de Cerebro Studio.' }

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const safe = typeof code === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(code) ? code : null
  return <LegalShell title="Eliminación de datos / Data deletion">
    {safe && <p className="notice" role="status">Solicitud recibida (código <code>{safe}</code>): las credenciales de esa cuenta se han borrado de Cerebro Studio. / Request received (code <code>{safe}</code>): that account&apos;s credentials have been deleted from Cerebro Studio.</p>}
    <h2>Desconectar una cuenta</h2>
    <p>En Cerebro Studio, abre <b>Conectores</b> (YouTube) o <b>Redes sociales</b> (Instagram y TikTok) y pulsa <b>«Desconectar»</b>. Se borran al instante las credenciales guardadas de esa cuenta.</p>
    <p>También puedes retirar el acceso desde la <a href="https://security.google.com/settings/security/permissions">configuración de tu cuenta de Google</a>, desde Instagram (Configuración → Apps y sitios web) o desde TikTok (Ajustes → Seguridad → Apps). Si lo haces desde Instagram, Meta nos avisa y borramos automáticamente las credenciales de esa cuenta.</p>
    <h2>Borrar todos tus datos</h2>
    <p>Escribe a <Contact /> desde el correo de tu cuenta pidiendo la eliminación. Borraremos tu cuenta de Cerebro Studio, tus proyectos, archivos y conexiones en un plazo máximo de 30 días y te lo confirmaremos.</p>
    <hr />
    <h2>English</h2>
    <p><b>Disconnect an account:</b> in Cerebro Studio open <b>Conectores</b> (YouTube) or <b>Redes sociales</b> (Instagram and TikTok) and click <b>«Desconectar»</b>; the stored credentials are deleted immediately. You can also revoke access from your Google account settings, Instagram (Settings → Apps and websites) or TikTok (Settings → Security → Apps). When you remove the app in Instagram, Meta notifies us and we delete that account&apos;s credentials automatically.</p>
    <p><b>Delete all your data:</b> write to <Contact /> from your account e-mail. We will delete your Cerebro Studio account, projects, files and connections within 30 days and confirm it.</p>
  </LegalShell>
}
