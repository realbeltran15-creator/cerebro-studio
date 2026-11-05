# Informe P5.8 — Estabilidad e integraciones gratuitas (0 €)

## 1. Estabilidad
- Chromium principal: 686/686 correctas. Sin fallos.
- Chromium laboratorio: **1 fallo intermitente** en la primera ejecución («verify (realtime): la exportación muestra la misma imagen que la vista previa, o el medidor de fidelidad avisa»); pasó 21/21 en dos ejecuciones posteriores aisladas. La comprobación es sensible al tiempo (exportación en tiempo real) y la primera ejecución fue justo después de la suite principal. No se atribuye a Miniaturas/Plantillas (no tocan ese camino). Queda registrado como intermitencia abierta; no se ha modificado la prueba.
- Vitest 1642 pruebas (incluye 4 nuevas de Pexels y 3 de Plantillas), tsc 0 errores, ESLint 0 errores, E2E módulos 29/29.

## 2. Verificación documental (fuentes oficiales leídas hoy)
| Servicio | Verificado | No confirmado |
|---|---|---|
| YouTube Data API | Cuota por defecto: 10.000 unidades/día combinadas para el resto de métodos **más 100 llamadas/día a `search.list`** (cubo aparte); ampliar exige auditoría de cumplimiento (developers.google.com/youtube/data/guides/quota_and_compliance_audits). `search.list` cuesta 1 unidad en el cubo de búsquedas (docs de `search.list`) | Coste exacto en unidades de otros métodos (la página enlazada de costes no pudo leerse) |
| YouTube Analytics API | Toda petición debe estar autorizada con OAuth 2.0; ámbito `yt-analytics.readonly` para informes (referencia oficial) | Cuota y precio concretos (la guía de inicio no se pudo leer) |
| Pexels API | Gratis; 200 solicitudes/hora y 20.000/mes por defecto; ampliable pidiéndolo con demostración; enlace destacado a Pexels en cada uso y crédito al fotógrafo cuando sea posible; prohibido replicar su funcionalidad o eludir límites; cabeceras `X-Ratelimit-*` | Términos de licencia completos (el texto enlazado estaba ilegible); la página se leyó casi entera, faltan ~4.000 caracteres |
| Freesound API | Estándar 60/min y 2.000/día (30/min y 500/día para escritura); 429 al superarlos; descargar el original exige OAuth2, las previsualizaciones (.ogg/.mp3) solo la clave; **gratis solo para uso no comercial**; prohibido registrar varias claves para eludir límites; acreditar según la licencia de cada sonido | Condiciones comerciales (hay que contactar con el equipo del servicio) |

Corrección: en el informe P5.7 indiqué que `search.list` costaba 100 unidades (fuente secundaria). La documentación oficial vigente lo trata como un cubo aparte de 100 llamadas/día; la app ya modelaba esto (`lib/research/cache.ts` reserva unidades y búsquedas por separado).

## 3. YouTube Data: ya preparado
No hay que escribir integración nueva: ya existen contador diario por día del Pacífico, reserva antes de gastar, caché y deduplicación de análisis, tope de búsquedas aparte, y 503 claro sin clave (`tests/research-quota.test.ts`, `research-without-youtube-key.test.ts`, `youtube-data.test.ts`). No se crea proyecto ni clave; no se hace ninguna solicitud. Cuando Jesús aporte una clave: añadir `YOUTUBE_API_KEY` y vigilar el cubo de 100 búsquedas/día.

## 4. Pexels: preparado y desactivado
`lib/stock/pexels.ts`: sin `PEXELS_API_KEY` no llama a la red; contador local que se detiene al 90 % de 200/hora y 20.000/mes; deduplica consultas idénticas; un 429 no se reintenta; siempre genera el texto de atribución y el rótulo «Fotos y vídeos proporcionados por Pexels». 4 pruebas con `fetch` simulado. Falta (con autorización): ruta de API y panel de búsqueda en Miniaturas/Editor que muestren la atribución.

## 5. Transcripción local (evaluación, sin instalar nada)
No hay Whisper ni Vosk instalados aquí; no se han descargado modelos. Opciones a evaluar con autorización: whisper.cpp con modelo `tiny`/`base` (decenas a un centenar de MB; consumo de RAM y velocidad **sin medir** en el PC de Jesús, que tiene ~3,6 GB) o Vosk (pip disponible, modelo pequeño). Riesgo: calidad en español y estabilidad del ordenador. Recomendación: medir primero un modelo `tiny` con un audio de 1 minuto antes de integrarlo.

## 6. Miniaturas: verificación completa
Imagen propia como base (la imagen de la Biblioteca aparece como «Imagen tuya»), texto exacto en 16:9, 9:16 y 1:1; ficheros guardados verificados por decodificación real: JPEG 1280×720, 720×1280 y 1080×1080 (la base PNG original queda intacta); las copias persisten tras recargar; el original no se modifica; sin llamadas a hosts externos; desbordamiento móvil cubierto por la auditoría a 375/390 px de los 30 módulos. Prueba: `npm run test:e2e:modules` (M24).

## Próximas autorizaciones necesarias
1. Clave gratuita de YouTube Data (la crea Jesús) → desbloquea Investigación, Radar, Oportunidades y Automatizaciones.
2. Clave de Pexels (gratuita) + permiso para conectar el panel de búsqueda.
3. Permiso para medir un modelo de transcripción pequeño en el PC de Jesús.
