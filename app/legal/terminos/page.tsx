import type { Metadata } from 'next'
import { Contact, LegalShell } from '../legal-shell'

export const metadata: Metadata = { title: 'Términos del servicio · Cerebro Studio', description: 'Condiciones de uso de Cerebro Studio.' }

export default function TermsPage() {
  return <LegalShell title="Términos del servicio / Terms of Service">
    <ol>
      <li>Cerebro Studio es una herramienta para crear y publicar <b>tu propio contenido</b>. Eres responsable de tener los derechos sobre lo que publicas y de cumplir las normas de cada plataforma.</li>
      <li>Al conectar YouTube aceptas los <a href="https://www.youtube.com/t/terms">Términos del servicio de YouTube</a>. Al conectar Instagram o TikTok aceptas sus condiciones y, en TikTok, su <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en">Confirmación de uso de música</a>.</li>
      <li>Nada se publica sin que lo apruebes y pulses «Publicar». La app muestra la cuenta de destino y su ID antes de cada publicación.</li>
      <li>Puedes desconectar tus cuentas y pedir la eliminación de tus datos en cualquier momento (ver la <a href="/legal/privacidad">política de privacidad</a>).</li>
      <li>El servicio se ofrece tal cual, sin garantías; podemos cambiar o retirar funciones que dependan de las API de terceros.</li>
      <li>Contacto: <Contact /></li>
    </ol>
    <hr />
    <h2>English</h2>
    <ol>
      <li>Cerebro Studio is a tool to create and publish <b>your own content</b>. You are responsible for holding the rights to what you publish and for following each platform&apos;s rules.</li>
      <li>By connecting YouTube you agree to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>. By connecting Instagram or TikTok you agree to their terms and, on TikTok, to its <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en">Music Usage Confirmation</a>.</li>
      <li>Nothing is published unless you approve it and click «Publish». The app shows the destination account and its ID before every publication.</li>
      <li>You can disconnect your accounts and request deletion of your data at any time (see the <a href="/legal/privacidad">privacy policy</a>).</li>
      <li>The service is provided as is, without warranties; features that depend on third-party APIs may change or be withdrawn.</li>
      <li>Contact: <Contact /></li>
    </ol>
  </LegalShell>
}
