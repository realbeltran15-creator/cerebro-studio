# Editor: música, efectos, subtítulos, referencias y comparación

Todo se calcula **en el navegador**, sin proveedores de generación, sin créditos y sin subir nada. Los números salen del archivo real (audio decodificado, fotogramas leídos); nada está dibujado con un patrón.

| Función | Dónde está | Código |
|---|---|---|
| Formas de onda reales en voz, música y efectos | Bloques de audio de la línea de tiempo | `lib/editor/waveform.ts`, `app/components/waveform-view.tsx` |
| Pulso de la música (golpes y BPM medidos) y marcadores | Pista de música; panel «Cortes con la música y efectos» | `lib/editor/beats.ts`, `lib/editor/beat-summary.ts` |
| Cortes visuales sincronizados: imán al arrastrar, «Dividir en el siguiente pulso», «Mover los cortes al pulso» | Línea de tiempo, inspector de clip, panel de sincronización | `lib/editor/sync.ts`, `app/components/editor-sync-panel.tsx` |
| Efectos de sonido en los cortes (cuándo, cuánto, cada cuántos) | Panel de sincronización | `lib/editor/cut-sfx.ts` |
| Subtítulos: importar/ver/editar/exportar SRT y VTT | Panel «Subtítulos» | `lib/editor/subtitles.ts`, `app/components/editor-subtitles-panel.tsx` |
| Vídeo de referencia (solo números) | Panel «Vídeo de referencia» | `lib/editor/reference.ts`, `app/components/editor-reference-panel.tsx` |
| Comparar montaje manual y automático | Panel «Comparar mi montaje con el automático» | `lib/editor/compare.ts`, `app/components/compare-view.tsx`, `editor-compare-panel.tsx` |
| Vídeos largos sin bloquear el navegador | Análisis en un Worker; la línea de tiempo dibuja solo lo visible (>120 clips); el editor automático usa el mismo análisis | `lib/editor/media-analysis.ts`, `analysis.worker.ts`, `analysis-client.ts`, `analysis-assets.ts` |
| Estilos: lo aprendido (efectos en los cortes con su momento y frecuencia, corte al pulso) y las referencias | «Aprende de mí» | `lib/editor/style.ts` (campos opcionales; los estilos guardados antes siguen valiendo) |

## Dónde se guarda cada cosa
- **Montaje:** `render_jobs.composition` (como hasta ahora). Nuevo: los efectos de los cortes llevan `origin: 'cut-sfx'` (se pueden reemplazar o quitar sin tocar los efectos puestos a mano), los subtítulos importados son `cues` de cada clip y `autoSnapshot` guarda, una sola vez, la versión automática de la que partió el montaje (duraciones y transiciones; es lo que se compara).
- **Estilos:** `connector_configs` (proveedor `cerebro-editor`, capacidad `edit_styles`), solo del propietario. Un estilo de referencia lleva `source: 'referencia'` y solo números.
- **Análisis de audio:** memoria de la sesión + IndexedDB de este navegador (clave por archivo; un archivo no cambia). Nada va al servidor.
- **Vídeo de referencia:** no se guarda ni se sube. Del resultado se conservan duración de planos, cortes por minuto, instantes de corte, silencio, rango dinámico, BPM y % de cortes en pulso. No hay fotogramas, audio, texto ni nombre de archivo.

## Límites conocidos (medidos, no supuestos)
- Los pulsos son **golpes reales** del audio con un umbral adaptativo; en música sin ataques claros (pads, voz sola) hay pocos o ninguno y el panel lo dice (regularidad baja). No se inventa una rejilla.
- La detección de cortes de la referencia usa 8 lecturas por segundo sobre fotogramas de 64×36: no ve fundidos suaves ni cortes de menos de ~125 ms.
- Un efecto «antes del corte» se enlaza al clip anterior: si se cambia la duración de ese clip hay que volver a aplicar el efecto.
- «Mover los cortes al pulso» no toca cortes junto a un clip con voz enlazada, ni deja clips de menos de 1 s, ni pide material que el vídeo no tiene.
- El análisis lee el archivo por su URL firmada con peticiones por rangos; si el servidor no lo permite, lo descarga una vez. Un vídeo de varias horas tarda en decodificarse (hay progreso y cancelación), pero no bloquea la página.
- Los formatos que se pueden leer dependen del navegador (WebCodecs): MP4 H.264, WebM y la mayoría de WAV/MP3/AAC/Opus en Chrome y Edge; Firefox y Safari pueden rechazar alguno y se avisa.
- La comparación con «el automático» necesita la versión guardada al abrir el montaje en manual; los montajes abiertos antes de esta versión solo se pueden comparar con otros montajes guardados.
