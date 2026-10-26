# Almacenamiento y exportación: auditoría con mediciones

Todas las cifras son medidas (fecha 25-10-2026) salvo donde se indica «no medido». Equipo de medición: contenedor de 2 CPU y 7,8 GB con Chromium sin interfaz (VP9; sin descodificador H.264), por lo que describen ese entorno, no una promesa para otros navegadores.

## 1. Dónde está cada cosa

| Qué | Dónde | Medido |
|---|---|---|
| Originales importados (vídeo, audio, imagen) | Supabase Storage, bucket privado `generated-assets` (o R2 si se configura; **no está activado**). Ruta `usuario/proyecto/uploads/…` | 69 objetos, 162,9 MB en total (17 % de la cuota de 0,95 GB) |
| Exportaciones guardadas en la Biblioteca | Mismo bucket, carpeta `renders` | 7 archivos = 121,2 MB (74 % de todo el bucket) |
| Imágenes/voces generadas con IA | Mismo bucket | ~22 MB; 25 filas no registraron su tamaño (la página Almacenamiento lo avisa) |
| Versiones de montaje | Mismo bucket, `versions/` | 31 objetos, 90 KB |
| Datos de montaje (proyecto, clips) | Tabla `render_jobs` (texto) | 30 montajes = 97,5 KB; el mayor 6,7 KB. Base de datos completa: 15,4 MB |
| 300 repeticiones de un clip | Solo JSON: todas apuntan al mismo archivo | 106,4 KB de JSON, 1 original; **0 bytes extra de material** |
| Borrador local y deshacer | IndexedDB del navegador | 1,6 MB en el navegador real |
| Miniaturas/proxies | No se guardan: se calculan en memoria | – |
| Material al editar y exportar | No se descarga al disco: se lee por rangos desde enlaces firmados | – |

## 2. Temporales de renderizado

- **Exportación en el navegador a «Descargar»**: el MP4 se arma entero en memoria y se entrega a la descarga (cabe en memoria: factor 2–2,7 × el tamaño, medido antes). No usa disco hasta que el navegador lo guarda en Descargas (disco interno por defecto).
- **Exportación en el navegador a «Carpeta o disco»** (nuevo): se escribe a medida que se produce, en el archivo que elijas. Medido en 1, 3 y 6 min de 1080p: pico de memoria JS 149/479/733 MB al armar en memoria frente a 202/669/286 MB escribiendo a archivo. A 6 min la escritura progresiva usa un 61 % menos de memoria JS; a 3 min no lo mejoró (el pico es ruidoso: depende del recolector de basura). La memoria total del proceso del navegador fue la misma (≈2,9 GB: dominada por la descodificación de los vídeos de origen, no por el archivo de salida). **Conclusión honesta:** la escritura progresiva elimina el crecimiento proporcional al tamaño del archivo, pero no reduce el resto del coste del navegador. En montajes de horas (archivo de varios GB) es lo que evita agotar la memoria.
- **Cancelar / disco lleno**: probado con un destino que rechaza la escritura a los 5 MB (QuotaExceededError): la exportación falla limpiamente, **0 bytes confirmados** en el archivo; cancelar a mitad deja también 0 bytes. El montaje no se toca.
- **Motor offline de Node/FFmpeg («Paquete para renderizar en mi PC»)**: carpeta de trabajo de 7,5 MB para un vídeo de 41 s y de 7,6 MB para uno de 201 s (40 repeticiones): los segmentos idénticos se renderizan una sola vez. Con contenido que no se repite la carpeta de trabajo crecerá (no medido); permanece tras terminar y puede borrarse. Descarga los materiales a `--work`: apuntándola a un disco externo (`--out E:\video.mp4 --work E:\temporal`) no usa el disco interno.
- ¿Una exportación de 90 min o 5 h necesita disco interno? En el navegador **no** si se elige «Carpeta o disco» (el único uso de disco interno es el swap de Chrome, que se crea junto al destino). Si se descarga: sí, el archivo completo termina en Descargas y antes en memoria. Con Drive en modo «Con temporal local»: sí, un temporal del tamaño del vídeo en el almacenamiento del navegador (disco interno) hasta terminar de subir. Con Drive en modo **«Directo mientras se renderiza»** (por defecto): **no**, ver sección 4.
- Después de exportar pueden borrarse con seguridad: el temporal de Drive (la página Almacenamiento lo lista y borra), la carpeta de trabajo del motor offline y el borrador local. **Nunca** los originales ni materiales usados.

## 3. Destinos de exportación (panel Exportar)

| Destino | Estado |
|---|---|
| Descargar a mi equipo | Funciona (probado en el Preview real). |
| Carpeta o disco externo | Funciona con el selector de archivos del navegador (Chrome/Edge); se elige **antes** de renderizar. Probado en el Preview real con un selector simulado que escribe en el almacenamiento del navegador: archivo MP4 de 4,2 MB, válido (ftyp, 1280×720, 12,01 s). **No probado con el diálogo nativo de Windows ni con un disco externo físico.** Chrome crea un `.crswap` junto al destino y lo confirma al cerrar. Firefox/Safari no ofrecen el selector: se desactiva la opción y se explica. |
| Google Drive | Carpeta con el selector oficial de Google. Dos modos: **directo** (se sube mientras se renderiza, sin archivo en este equipo; ver sección 4) y **con temporal local** (se puede reintentar la subida sin volver a renderizar). La importación desde Drive se probó de extremo a extremo con Google real; la **subida directa de exportaciones solo con un Drive simulado fiel al protocolo** (falta una prueba real con H.264+AAC en el Chrome del usuario). El vídeo se renderiza en tu navegador y se sube desde él: no pasa por ningún servidor nuestro. |
| Biblioteca de Cerebro Studio | Funciona; muestra cuota libre y máximo por archivo (50 MB en Supabase gratuito). |
| OneDrive, Dropbox | No disponibles: requieren registrar una aplicación en cada servicio. |

Sin R2 ni infraestructura de pago activada. Los vídeos de más de 50 MB solo caben en «Carpeta/disco», «Descargar» o Drive.

## 4. Exportación directa a Drive (sin copia en el equipo)

**Diseño.** `lib/ingest/drive-stream.ts` abre la sesión reanudable de Drive *antes* de renderizar (si la carpeta o el permiso fallan, falla al instante) y recibe la salida del exportador como un `WritableStream`. Envía bloques de 8 MiB (`Content-Range: bytes a-b/*`, tamaño total solo en el último). En memoria hay como mucho ~3 bloques. El MP4 se genera **fragmentado** (`fastStart: 'fragmented'`), que solo añade al final; una escritura hacia atrás se rechaza con un mensaje claro en vez de corromper el archivo. Un corte de red continúa desde el byte que Drive ya tiene (`bytes */*`); 5xx/429 se reintentan. Cancelar, error o cierre cancelan la sesión en Drive (no queda un archivo a medias). Si se cierra la pestaña a mitad, el codificador no puede reanudarse: hay que volver a exportar.

**Mediciones** (Drive simulado con el protocolo, Chromium de pruebas con VP9; 1080p, 30 fps, 2 CPU / 7,8 GB):

| Duración | Modo | Tiempo | Archivo | Temporal en disco/almacenamiento del navegador | Pico buffer de subida | Pico RSS |
|---|---|---|---|---|---|---|
| 1 min | con temporal | 72 s | 57,8 MB | 57,8 MB | – | 1794 MB |
| 1 min | directo | 79 s | 57,8 MB | **0 MB** | 9,8 MB (7 bloques) | 1932 MB |
| 2 min | con temporal | 165 s | 115,2 MB | 115,2 MB | – | 2174 MB |
| 2 min | directo | 233 s | 115,2 MB | **0 MB** | 8 MB (14 bloques) | 2225 MB |

Datos idénticos y en el mismo orden en ambos modos; 0 errores de descodificación; duración correcta. El modo directo fue más lento en estas pruebas (causa sin determinar). El disco físico del PC no puede leerse desde una página web: lo medido es `navigator.storage.estimate()` y los bytes recibidos por el Drive simulado. Reproducir: `node scripts/measure-drive-stream.mjs --minutes 2`.

## 5. Calidad real (matriz medida con ffprobe, 12 s, `node scripts/measure-quality.mjs`)

Cada ajuste produce resultado real, no solo etiqueta: resolución, fps, bitrate y fotogramas coinciden con lo pedido; 0 fotogramas negros, 0 congelados, 0 errores de descodificación y diferencia audio/vídeo 0 ms en los 15 casos.

| Caso | Resolución | fps | Bitrate pedido → medido (kbit/s) | MB |
|---|---|---|---|---|
| 480p normal | 854×480 | 30 | 1200 → 1354 | 1,9 |
| 720p normal / alta | 1280×720 | 30 | 2500 → 2635 / 5000 → 4791 | 3,8 / 6,9 |
| 1080p normal / alta | 1920×1080 | 30 | 5000 → 5378 / 8000 → 8115 | 7,7 / 11,6 |
| 1440p normal / alta | 2560×1440 | 30 | 9000 → 8953 / 14000 → 13461 | 12,8 / 19,3 |
| 2160p normal / alta | 3840×2160 | 30 | 16000 → 16178 / 25000 → 24241 | 23,2 / 34,7 |
| 720p 24 fps / 60 fps | 1280×720 | 24 / 60 | 2125 → 2054 / 4000 → 4585 | 2,9 / 6,6 |
| 720p audio 96k / 320k | 1280×720 | 30 | 2500 → 2603 / 2827 | 3,7 / 4,1 |
| 720p 12000 kbit/s | 1280×720 | 30 | 12000 → 10682 | 15,3 |

Limitaciones: medido con VP9/Opus (el Chromium de pruebas no tiene H.264); en contenido ruidoso VP9 superó hasta ~+50 % el bitrate pedido en las pruebas de Drive (57,8 MB/min a 5 Mbit/s pedidos), por lo que el tamaño previsto es una estimación. H.264/AAC (el formato que usa Chrome real) no está medido aquí. **No se ha hecho ninguna exportación real de 90 min–5 h**: las cifras de esas duraciones son extrapolaciones, no mediciones.

## 6. iPhone y Dropbox

- **Guardar en el iPhone (hoja de compartir):** el vídeo se renderiza en memoria (Safari no puede escribir archivos por trozos) y al terminar aparece el botón «Guardar en el iPhone», que abre la hoja de compartir (Guardar vídeo / Guardar en Archivos). iOS solo permite abrirla con un toque, por eso es un botón y no automático. Bloqueado a partir de ~0,8 GB estimados; para vídeos largos, Drive o Dropbox y bajarlo con su app.
- **Dropbox:** subida por sesiones (`upload_session/start → append_v2 → finish`) en bloques de 8 MiB mientras se renderiza, sin copia local, con reintentos y comprobación de tamaño final (`lib/ingest/dropbox-stream.ts`). Login OAuth con PKCE en ventana emergente (`lib/ingest/dropbox-auth.ts`, página `/dropbox-callback`); el token solo vive en memoria.
- **Para activarlo:** crear una app gratuita en dropbox.com/developers (Scoped access, «App folder», permiso `files.content.write`), añadir `https://<dominio>/dropbox-callback` como Redirect URI y poner la App key en `NEXT_PUBLIC_DROPBOX_APP_KEY` (Vercel, entorno Preview). Sin la clave, la opción aparece desactivada.
- Probado con un Dropbox simulado (4 tests); sin App key no se ha podido probar contra Dropbox real.
