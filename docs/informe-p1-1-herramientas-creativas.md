# P1.1 — Auditoría e integración de herramientas creativas (local, 0 €)

| Módulo | Estado real | Defectos / correcciones | Pruebas (R=real, S=simulado) | Puntuación interna* |
|---|---|---|---|---|
| Exportación (integridad) | Motor offline FFmpeg | Temporales `.part` con nombre fijo → dos exportaciones al mismo destino/carpeta se pisaban. Ahora únicos por intento, se limpian en fallo; un fallo/cancelación no sustituye un MP4 válido | R: colisión mismo destino y misma carpeta, cancelación, fallo FFmpeg, recuperación | 90 |
| Materiales / Añadir | Importación mono-hilo con duplicados, cancelación, reanudación, límite por archivo | No se comprobaba el contenido real: un `.exe` con MIME de vídeo pasaba. Nuevo sniffing de cabecera (`lib/ingest/sniff.ts`) antes de subir (JPEG/PNG/WebP/WAV/MP4/MOV (también `moov`/`wide`)/WebM/MP3/OGG/FLAC) | R: classify, duplicados, ids seguros, recorrido importar→material→montaje→MP4→original con hash idéntico y procedencia; S: subida/BD | 88 |
| Estudio de creación | Backend con confirmación de coste, tope de gasto, modelos «ready» | `generate()` sin guarda de doble envío ni captura de fallo de red (trabajo atascado en «enviando», doble pago posible). Corregido; mensaje de «revisa la Biblioteca antes de reintentar» | Sin test automático de UI (cambio de página); no se ejecutó ningún proveedor | 86 |
| Editor: generar voz/imagen/vídeo | Rutas `/api/providers/voice\|image\|video` NO existen | Botones desactivados con «pendiente de conexión», sin confirmación de gasto falsa | R: tsc/build | 85 |
| Música y Sonido | Mezcla del motor | Sin defectos nuevos | R (FFmpeg + volumedetect): vídeo sin audio + música, volumen 0,25 ≈ −12 dB, silenciada, fundidos, desplazamiento/recorte, varias pistas sin recortar (pico ≤ 0 dB). No cubierto: reproducción WebAudio en vivo | 88 |
| Miniaturas | Composición en navegador, solo 16:9 | Solo 16:9: añadido 9:16 y 1:1 con recorte `cover` sin deformar (`coverRect`) y selector en pantalla | R: geometría; no probado el canvas real (requiere navegador) | 85 |
| Virtual Influencer | Módulo grande con API propia (jobs, identidad, referencias) | Sin auditar a fondo en esta pasada (pendiente) | 1 fichero de tests existente | — |

*Puntuación interna orientativa (rúbrica del proyecto), no medida por usuarios.

Validación: tsc limpio; 145 ficheros / 1444 tests OK (13 omitidos); next build OK. Coste: 0 €. Sin push, sin migraciones aplicadas.
Pendiente: Virtual Influencer, pruebas en navegador real, SQL propuestos sin aplicar (transcripción única, bloqueo, storyboard RPC, escenas).
