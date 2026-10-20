# Licencias de terceros: conversión de vídeo en el navegador · 20-10-2026

## Camino por defecto: sin componentes GPL

| Pieza | Licencia | Cómo se usa |
|---|---|---|
| Codificador H.264 del navegador (WebCodecs) | Licencia del fabricante del navegador | No se distribuye nada: lo aporta Chrome, Edge, Safari o Firefox |
| Codificador AAC del navegador | Licencia del fabricante del navegador | Cuando el navegador lo tiene: Chrome y Edge en Windows y macOS, y Safari 26 o posterior |
| [`mediabunny`](https://github.com/Vanilagy/mediabunny) 1.61.3 | MPL-2.0 | Lee y escribe el contenedor y gestiona la conversión. Se usa sin modificar |
| [`@mediabunny/aac-encoder`](https://mediabunny.dev/guide/extensions/aac-encoder) 1.61.3 | MPL-2.0 (paquete). Dentro va el codificador AAC nativo de FFmpeg (libavcodec), compilado a WASM: es la parte LGPL-2.1-or-later de FFmpeg, sin x264 ni ningún otro componente GPL | Se descarga solo cuando el navegador no tiene AAC: Firefox y navegadores en Linux. Va en un fragmento aparte, sin modificar |

### Obligaciones

- **MPL-2.0:** si se modifican archivos de Mediabunny, hay que publicar esas modificaciones. No se modifican.
- **LGPL-2.1 (codificador AAC de FFmpeg):**
  - Hay que conservar el aviso de licencia y señalar dónde está el código fuente: [FFmpeg](https://ffmpeg.org/legal.html) y el [repositorio de Mediabunny](https://github.com/Vanilagy/mediabunny).
  - El usuario debe poder sustituir esa biblioteca. Se cumple porque es un módulo separado que se carga dinámicamente y no está mezclado con el código de Cerebro Studio.

**No hace falta ninguna decisión de licencia GPL para usar la conversión.**

## Alternativa opcional (desactivada): ffmpeg.wasm con x264

- `@ffmpeg/core` incluye x264 y es **GPL-2.0-or-later**. No está en el repositorio ni en el despliegue.
- Solo se usa si el propietario configura `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL`. Sirve de alternativa cuando el navegador no tiene codificador H.264 en WebCodecs, por ejemplo versiones antiguas.
- Activarla sigue siendo decisión del propietario. Sin ella, esos navegadores renderizan directamente en Chrome, Edge o Safari, que ya producen MP4 H.264.
