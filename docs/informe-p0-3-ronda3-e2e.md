# P0.3 ronda 3 — E2E real con FFmpeg (local, 0 €)

## Qué es REAL y qué es SIMULADO
| Paso | Estado |
|---|---|
| Guion → escenas (`scriptToScenes`) | REAL (código de la app) |
| Storyboard → Montaje (`syncWithScenes`), idempotencia, reordenado | REAL |
| Montaje → MP4 (`lib/render/engine`, FFmpeg/FFprobe 6.1.1) | REAL (motor offline de Node que usa las mismas funciones puras que el editor) |
| QC del MP4 (`inspectMedia`: decodificación completa, fotogramas, audio) | REAL |
| SRT/VTT (`exportSubtitles`/`parseSubtitles`, aceptado por ffmpeg) | REAL |
| Biblioteca / base de datos / almacenamiento | SIMULADO (solo se comprueba `incompleteRenderNotice`; NO es integración real) |
| Exportador del navegador (WebCodecs/MediaRecorder) | NO CUBIERTO (requiere Chromium real) |
| Transiciones entre pasos | Las de arriba marcadas REAL son reales; ninguna se presenta como E2E completo por la parte simulada |

## Defectos encontrados y corregidos
1. **Render colgado si FFmpeg falla al arrancar** (codificador de vídeo y de audio): la escritura esperaba un `drain` que nunca llegaba. Ahora el fallo del codificador corta el bucle y da un error claro; no queda MP4 final. Reintento posterior OK.
2. Descarga en «Editar con mi estilo»: sin `r.ok`, sin límite, sin cancelar → `fetchMediaBlob` (límite real durante el flujo, no solo `Content-Length`; cancelación).
3. Transcripción: dedupe con `.maybeSingle()` fallaba con 2 filas; bloqueo en vuelo (409). Bloqueo persistente multi-instancia: puerto `LockStore` + tests de concurrencia (8 intentos → 1 ejecución, caducidad) + SQL propuesto (NO aplicado, sin probar). La ruta sigue usando el bloqueo en memoria hasta que se apruebe la migración (limitación: solo vale dentro de una instancia).
4. Hallazgo honesto: un montaje con narración y sin voz se marca «incompleto» (correcto).
5. Nueva acción «Abrir en el Editor» en Storyboard (solo navega; el Editor sincroniza sin pisar montajes manuales).

## Pruebas (tests/e2e-produccion.test.ts, 10)
Resolución/FPS/duración/códec h264+aac/sincronía A/V (<0,15 s)/fotogramas exactos/color por escena; SRT/VTT; sin audio y sin subtítulos; cancelación (sin archivo final); fallo de FFmpeg + reintento; material ausente y montaje vacío; dos exportaciones simultáneas (destinos distintos).
Validación: tsc limpio; 142 ficheros / 1425 tests OK; next build OK.

## Pendiente
Dos exportaciones al MISMO destino (no cubierto), E2E en navegador real, migraciones SQL (no aplicadas), push (sin autorización).
Coste: 0 €.
