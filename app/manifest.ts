import type { MetadataRoute } from 'next'

/**
 * Web app manifest: lets the owner add Cerebro Studio to the iPhone home screen (Safari › Compartir › Añadir a pantalla de inicio),
 * opening straight on «Añadir materiales». There is no share_target: iOS ignores it (WebKit does not implement Web Share Target);
 * the iPhone share sheet goes through the Shortcut described on that page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cerebro Studio', short_name: 'Cerebro', description: 'Investiga, crea, edita y publica vídeo.',
    start_url: '/add', scope: '/', display: 'standalone', background_color: '#101328', theme_color: '#101328', lang: 'es',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }, { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  }
}
