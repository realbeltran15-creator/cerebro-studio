# Exportación: por qué se paraba en segundo plano y qué se ha hecho

Estado: octubre de 2026, rama `fase1-seguridad`. Nada de pago activado.

## Cómo funciona la exportación rápida

`lib/editor/fast-export.ts` dibuja cada fotograma en un canvas y lo codifica con WebCodecs a través de Mediabunny. No espera al tiempo real ni usa `requestAnimationFrame`. El audio se mezcla con `OfflineAudioContext` en trozos de 10 s. El archivo se monta en memoria y, al terminar, se sube a la Biblioteca o se descarga.

## Qué la frena o la para (según el código, las pruebas y la documentación de Chrome)

| Causa | Efecto | Estado |
|---|---|---|
| Temporizadores en pestañas ocultas: Chrome los limita a 1 por segundo y, tras 5 min, a 1 por minuto | Mediabunny ya usa sus propios temporizadores en un Worker para evitarlo (`unthrottledTimerWorker`). El bucle de exportación no usa temporizadores. | No es la causa |
| Congelación de pestañas ocultas: Chrome 133+ con Ahorro de energía, tras 5 min oculta y en silencio | Todas las tareas se detienen y la exportación queda parada hasta volver a la pestaña. No se pierde nada. | Mitigado, no evitable al 100 % |
| Panel del navegador de Claude oculto (pruebas) | Ese panel deja de dibujar y de ejecutar cuando no está a la vista. Es lo que paró la exportación de prueba a los 4,2 s. | Es un límite del entorno de pruebas, no de la app |
| Cerrar o recargar la pestaña | El vídeo solo existe en la memoria de la pestaña hasta que se guarda. | Ahora se pide confirmación |
| Exportación «solo descargar» | Al terminar intentaba guardar `output_manifest`, una columna que no existe en la base real. El trabajo no quedaba como completado y el error se ignoraba. | **Corregido** |

Fuente sobre la congelación: [Chrome for Developers, «Freezing on Energy Saver»](https://developer.chrome.com/blog/freezing-on-energy-saver). Una pestaña no se congela si tiene un Web Lock que otra pestaña está esperando, si reproduce sonido, si usa cámara o micrófono, o si lleva menos de 5 min oculta.

## Protecciones nuevas (`lib/editor/export-guard.ts`, gratuitas)

- **Web Lock `cerebro-export`** mientras dura la exportación. Si hay dos exportaciones en dos pestañas, la segunda espera el candado y Chrome no congela la primera. Con una sola pestaña, Chrome puede congelarla igualmente en Ahorro de energía después de 5 min oculta.
- **Pantalla encendida** (Screen Wake Lock) mientras la pestaña está a la vista, para que el equipo no se suspenda a mitad.
- **Confirmación antes de cerrar o recargar** la pestaña.
- **Avisos en el panel**:
  - «La pestaña está oculta…».
  - «La pestaña estuvo oculta X s; la exportación continúa…».
  - Si no avanza en 20 s, dice si la causa es que la pestaña está oculta (sigue sola al volver) o propone cancelar y probar el modo en tiempo real.
- Todo se suelta al terminar, al cancelar o si hay un error.

## Pruebas reales

- `tests/export-guard.test.ts` (5 pruebas): candados, confirmación al cerrar, tiempo oculto, detección de parada y navegadores sin estas APIs.
- Sección 33 de `scripts/browser-tests.mjs`, en Chromium real con el editor real:
  - el candado aparece al exportar y desaparece al terminar;
  - se pide confirmación al cerrar;
  - los avisos funcionan al ocultar y volver;
  - el archivo exportado se analiza con **ffprobe**: vídeo 1280×720 con audio y 13 s de duración.
- Las secciones 24 y 25 ya comparaban la exportación con el visor en los mismos instantes: capas, fotos, dos músicas, voz, efecto, transiciones a mitad y automatización de volumen.

## Exportación sin navegador: el motor offline (hecho, gratuito)

`lib/render/engine.ts` (Node + FFmpeg + `@napi-rs/canvas`) renderiza el mismo montaje **sin navegador y sin pestaña abierta**, con el mismo código que el editor para decidir qué se ve (`frameAt`), cómo se dibuja (`drawOps`) y cómo suena (`audioVoices`, `voiceGainAt`, `busLevels`…). No hay coste: corre en tu PC con FFmpeg.

Cómo trabaja:

- **Trozos**: la línea de tiempo se corta en cada clip y en tramos de ≤ 60 s. Cada trozo tiene una huella (ajustes + lo que se dibuja en cada fotograma, con los archivos identificados por nombre/tamaño/fecha). **Trozos idénticos se renderizan una sola vez** y se reutilizan (un lo-fi de 90 min con 4 escenas en bucle: 180 trozos, 10 distintos).
- **Reanudable**: si se corta, se vuelve a lanzar con la misma carpeta de trabajo y solo se rehacen los trozos que faltan (archivo `.part` + renombrado al terminar).
- **Vídeo**: FFmpeg lee cada vídeo en su propio proceso; los fotogramas van a x264 (veryfast, crf 20, `maxrate` del plan, GOP de 2 s, etiquetado bt709).
- **Audio**: se mezcla en bloques de 10 s con la misma automatización de volumen, ducking, bucles y paneo que el editor; AAC 128 kbit/s a 48 kHz.
- **Unión**: concat sin recodificar + audio → MP4 con `+faststart`.
- **Cancelable** (AbortSignal), con progreso (plan / vídeo / audio / unión), `--from/--to` para renderizar solo un tramo y `--font` para registrar tipografías.

Uso (en tu PC, con Node y FFmpeg):

```
node scripts/render.mjs ticket paquete-render.json --out video.mp4      # lo que descarga el editor
node scripts/render.mjs render proyecto.json --assets assets.json --out video.mp4
node scripts/render.mjs lofi --music m.mp3 --scenes a.mp4,b.jpg --minutes 90 --out lofi.mp4
```

- **Paquete de render** (botón «Paquete para renderizar en mi PC» en el panel de exportación): guarda el montaje, crea una fila `render_jobs` en estado `queued` y descarga un JSON con el montaje y **enlaces firmados de 4 h** a tus materiales. No contiene contraseñas ni claves. El CLI descarga los materiales (reanudable con `Range`, no repite los ya descargados) y renderiza. El vídeo resultante se sube a la Biblioteca con la subida normal (por partes y reanudable si es grande).
- **Instrucción tipo «Prepara un vídeo lo-fi de 90 minutos…»**: `lofi` analiza con ffprobe las duraciones, reparte las escenas en bucle (`lib/editor/loop-montage.ts`, determinista, sin IA ni créditos), aplica transiciones de disolución de 1,5 s, cámara lenta de zoom en las fotos, música en bucle y exportación a 1080p, guarda `project.json` + `assets.json` (el montaje es un montaje normal: se puede abrir en el editor) y renderiza.

### Paridad con el editor (comprobada, no supuesta)

- `node scripts/parity-test.mjs` (Chromium real): el motor y el navegador renderizan el mismo montaje de 13 s (transiciones disolución/cortina/deslizar, vídeo superpuesto, título, subtítulos, dos músicas con automatización, voz con ducking, efecto de sonido). Los píxeles coinciden (±24) en puntos normales y a mitad de transición, y los niveles de cada tono de audio coinciden (±25 %), silencios incluidos.
- `node scripts/looks-test.mjs` (Chromium real): filtros (brillo, contraste, saturación), desenfoque, «Igualar imagen» con temperatura, opacidad, rotación, recorte, cámara (zoom, panorámica, zoom/foco), vídeo a cámara lenta y subtítulos en los tres estilos: diferencia media de 2–4 niveles sobre 255; ≥ 98 % de la rejilla de 32×18 puntos dentro de ±40 en los ocho casos.
- Diferencia **conocida y documentada**: la exportación rápida del navegador pinta distinto un vídeo VP9 sin etiqueta de color (170 frente a 200 en el verde de prueba); el motor y el visor coinciden entre sí.
- **Tipografías**: el texto pide fuentes del sistema por nombre (Segoe UI, Georgia, Impact, Consolas…). Si el equipo no las tiene, el motor dibuja una sustituta y **lo avisa** («Fuente … no instalada», con la opción `--font archivo.ttf`). En Windows con las fuentes habituales no debería haber diferencia; en este entorno de pruebas (Linux) sí hay sustitutas, por eso los subtítulos se comparan por posición y color, no por forma de letra.
- Funciones que el motor **no** aproxima en silencio: todo lo que `frameAt` produce pasa por `drawOps`; si en el futuro se añade un tipo nuevo de operación al editor sin soportarlo aquí, la prueba de paridad lo detecta al compararlo.

### Prueba real de 90 minutos (octubre de 2026)

- Proyecto de prueba: música instrumental sintética en bucle y cuatro escenas generadas con FFmpeg (materiales propios, sin derechos de terceros), tramos de 30 s con disolución de 1,5 s y cámara lenta de zoom, 1080p a 30 fps (`node scripts/render.mjs lofi … --minutes 90`).
- Resultado verificado con ffprobe y ffmpeg: **5400,000 s exactos**, 162 000 fotogramas, 1920×1080, H.264 High yuv420p con etiquetas bt709, AAC LC 48 kHz estéreo (253 126 paquetes = 5400 s), `+faststart`, 652 MB (≈ 0,97 Mbit/s), inicio de vídeo y audio en 0,000.
- **Decodificación completa** del archivo de principio a fin sin ningún error. Nivel de audio estable en cinco puntos distintos (media −28…−30 dB, pico −17 dB, sin recortes; −26,3 LUFS integrado).
- Tiempo: unos 23 min en un entorno de 2 CPU (≈ 7–10 fps en los trozos únicos; los 170 trozos repetidos se reutilizan). Un PC de sobremesa irá más deprisa.
- Alcance honesto: esta prueba usa material sintético y una sola secuencia repetida; demuestra la duración, la estabilidad, la sincronía global (misma duración de vídeo y audio, inicio común) y la reutilización de trozos. La sincronía fina entre un vídeo con audio propio y la imagen se comprobó en la prueba de paridad corta (tonos de los vídeos en el instante correcto). No se ha repetido con vídeos reales con audio de 90 min.

### Qué sigue sin estar hecho

- No hay un servidor que renderice solo: el motor corre en tu PC (gratis). Un servidor tendría coste mensual y no se ha contratado.
- El resultado local se sube a la Biblioteca con la subida normal; no hay todavía un trabajador que consulte `render_jobs` y lo suba solo.
