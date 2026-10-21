import type { Metadata } from 'next'
import { Contact, LegalShell } from '../legal-shell'

export const metadata: Metadata = { title: 'Política de privacidad · Cerebro Studio', description: 'Cómo Cerebro Studio trata los datos de las cuentas de YouTube, Instagram y TikTok.' }

export default function PrivacyPage() {
  return <LegalShell title="Política de privacidad / Privacy Policy">
    <h2>Qué es Cerebro Studio</h2>
    <p>Cerebro Studio es una herramienta web para investigar temas, producir, editar y publicar vídeos propios en YouTube, Instagram y TikTok. Nada se publica sin dos acciones explícitas de la persona usuaria: aprobar el trabajo y pulsar «Publicar».</p>
    <h2>Datos que obtenemos de las plataformas conectadas</h2>
    <ul>
      <li><b>YouTube (Google):</b> con <code>youtube.readonly</code>, el nombre y el ID de tu canal y los datos de los vídeos que subes desde la app (para comprobar el canal de destino y la visibilidad); con <code>youtube.upload</code>, solo subimos los vídeos que tú apruebas y publicas; con <code>yt-analytics.readonly</code>, informes de analítica de tu propio canal para mostrártelos.</li>
      <li><b>Instagram (Meta):</b> con <code>instagram_business_basic</code>, el ID y el nombre de usuario de tu cuenta profesional; con <code>instagram_business_content_publish</code>, solo publicamos los Reels que tú apruebas y publicas.</li>
      <li><b>TikTok:</b> con <code>user.info.basic</code>, tu identificador (open_id) y nombre visible; con <code>video.publish</code>, solo publicamos los vídeos que tú apruebas y publicas, con la privacidad que eliges.</li>
    </ul>
    <h2>Cómo los usamos y guardamos</h2>
    <ul>
      <li>Solo para las funciones que ves en la app: conectar la cuenta, mostrar a qué cuenta se publicará, publicar lo que apruebas y mostrarte tus estadísticas.</li>
      <li>Los tokens de acceso se guardan <b>cifrados (AES-256-GCM) en el servidor</b>; el navegador no puede leerlos.</li>
      <li><b>No vendemos, no cedemos ni compartimos</b> estos datos con terceros, ni los usamos para publicidad, ni para entrenar modelos de IA.</li>
      <li>El uso y la transferencia a cualquier otra app de la información recibida de las API de Google se ajustan a la <a href="https://developers.google.com/terms/api-services-user-data-policy">Política de datos de usuario de los servicios de API de Google</a>, incluidos los requisitos de uso limitado (Limited Use).</li>
      <li>Cerebro Studio usa los Servicios de API de YouTube. Al conectar YouTube aceptas también la <a href="https://policies.google.com/privacy">Política de privacidad de Google</a>.</li>
    </ul>
    <h2>Cuánto tiempo y cómo eliminarlos</h2>
    <ul>
      <li>Conservamos la conexión mientras la mantengas. Al pulsar «Desconectar» en Conectores o en Redes sociales se borran las credenciales guardadas.</li>
      <li>Puedes retirar el acceso en cualquier momento desde la <a href="https://security.google.com/settings/security/permissions">configuración de seguridad de tu cuenta de Google</a>, desde los ajustes de apps de Instagram o desde los ajustes de TikTok.</li>
      <li>Para borrar tu cuenta y todos tus datos de Cerebro Studio sigue <a href="/legal/eliminar-datos">estas instrucciones</a>.</li>
    </ul>
    <h2>Contacto</h2>
    <p><Contact /></p>

    <hr />
    <h2>English</h2>
    <p>Cerebro Studio is a web tool to research, produce, edit and publish the user&apos;s own videos to YouTube, Instagram and TikTok. Nothing is ever published without two explicit actions by the user: approving the job and clicking «Publish».</p>
    <p><b>Data we receive:</b> YouTube — channel name and ID and data of the videos uploaded from the app (<code>youtube.readonly</code>, to confirm the destination channel and visibility), uploads only of videos the user approves and publishes (<code>youtube.upload</code>), and analytics reports of the user&apos;s own channel (<code>yt-analytics.readonly</code>). Instagram — professional account ID and username (<code>instagram_business_basic</code>) and publishing only of approved Reels (<code>instagram_business_content_publish</code>). TikTok — open_id and display name (<code>user.info.basic</code>) and publishing only of approved videos with the privacy the user selects (<code>video.publish</code>).</p>
    <p><b>Use and storage:</b> only for the features shown in the app. Access tokens are stored encrypted (AES-256-GCM) on the server and are never readable by the browser. We do not sell, transfer or share this data with third parties, use it for advertising, or use it to train AI models. Cerebro Studio&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Cerebro Studio uses YouTube API Services; see the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>
    <p><b>Retention and deletion:</b> connections are kept until the user disconnects them, which deletes the stored credentials. Access can be revoked at any time from the <a href="https://security.google.com/settings/security/permissions">Google account security settings</a>, Instagram app settings or TikTok settings. See <a href="/legal/eliminar-datos">data deletion instructions</a>.</p>
    <p><b>Contact:</b> <Contact /></p>
  </LegalShell>
}
