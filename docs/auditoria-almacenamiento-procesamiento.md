# Auditoría técnica: almacenamiento y procesamiento de proyectos grandes

Estado: 24 de octubre de 2026, rama `fase1-seguridad`. Nada de pago activado, Producción intacta, ningún dato ni caché borrado.

Convención: **[M]** medido aquí, **[E]** estimado a partir de mediciones, **[D]** dato documentado por un tercero (no medido), **[?]** desconocido.

Las mediciones salen de `node scripts/measure-local.mjs` (Chromium real con el reproductor y el exportador del editor, materiales servidos con `Range` como los enlaces firmados) en un entorno de 2 CPU y 7,8 GB de RAM, sin GPU y con vídeo VP9 (ese Chromium no decodifica H.264). Son cifras de **este** equipo y navegador: indican órdenes de magnitud y proporciones, no garantías para otro PC. Material de prueba: 3 vídeos 1080p de 30 s con ruido (53–70 MB cada uno, ≈ 15 Mbit/s: más pesado que un móvil normal), una foto de 12 Mpx (5,4 MB), un MP3 de 3 min (4,1 MB), montados con el constructor de bucle (90 min, 180 clips).

## 1. Dónde están los originales (vídeo, música, imágenes)

- Bucket privado `generated-assets` de **Supabase Storage**, clave `<usuario>/<proyecto o library>/<carpeta>/<archivo>` [código].
- Con las 4 variables `R2_*`, los archivos nuevos van a **Cloudflare R2** con ruta `r2:…`. Hoy hay **0 archivos en R2** [M, consulta a la base]. Ambos almacenes conviven.
- La tabla `assets` guarda tipo, ruta y procedencia; cada archivo existe una vez y los montajes lo referencian por id.
- Estado real de tu cuenta [M, solo lectura]: 51 objetos, **159,8 MB** (16 % del 1 GB gratuito), el mayor 32,3 MB, 36 filas en `assets`, 0 en R2.

## 2. Dónde está lo demás

| Qué | Dónde | Tamaño |
|---|---|---|
| Montaje completo (pistas, capas, efectos, transiciones, ajustes) | `render_jobs.composition` (JSON en Postgres) | **51 KB** para 90 min / 180 clips [M]; tus 25 montajes actuales: máx. 2,4 KB, media 1,5 KB [M] |
| Versiones y puntos de recuperación | Supabase Storage, `<usuario>/<proyecto>/versions/<montaje>/<hora>-<motivo>.json`; se guardan 30 normales + 30 «antes de quitar» | ≈ 55 KB cada uno a 90 min → hasta ≈ 3 MB por montaje [E]; hoy 15 archivos [M] |
| Preferencias, favoritos, ajustes | `connector_configs` | pequeño |
| Copia local de recuperación + historial de deshacer (30 pasos) | IndexedDB del navegador | **0,2 MB** a 90 min [M] |
| Análisis de audio (forma de onda, compases) | IndexedDB (`cerebro-editor-analysis`), una entrada por archivo | por archivo; ≈ 50 puntos por segundo de audio [código]; 3 min ≈ 9 000 puntos [E] |
| Disposición de paneles, claves de reanudación de subidas | localStorage | bytes |

## 3. Qué se descarga al ordenador al editar

Nada se copia a mano. El reproductor lee los materiales con **solicitudes por rangos** desde enlaces firmados y mantiene como máximo 12 vídeos y 24 audios activos (cada uno se libera a los 15 s sin uso) [código].

- Abrir el montaje de 90 min y tener el primer fotograma: **33,7 MB** descargados [M].
- Reproducir 60 s: **+86 MB** (total 120 MB) [M].
- Saltar al minuto 45 y al 89 y reproducir 25 s: sin descarga nueva en el 45 y +16,7 MB en el 89 [M]. Ojo: este montaje repite solo 4 archivos (190 MB en total) y el navegador reutiliza lo ya leído. En un proyecto con 90 min de material **distinto** lo descargado será ≈ lo que se mira: unos 1 MB por segundo visto a 8 Mbit/s [E].
- Las **fotos se descargan enteras** (5,4 MB cada una de 12 Mpx) aunque la pantalla muestre 1080p [M].

## 4. Qué ocupa RAM, caché, IndexedDB, temporales y disco

| Recurso | Qué guarda | Medición |
|---|---|---|
| RAM del navegador (todos sus procesos) | decodificadores, fotogramas, bitmaps | página vacía 655 MB → montaje abierto 831 MB → tras reproducir 60 s 1 409 MB → tras saltar a otros minutos 1 374–1 431 MB [M]. Estable: no crece con la longitud de la línea de tiempo |
| Montón de JavaScript | estado del editor | 7–8 MB con 180 clips [M] |
| Fotos | un bitmap decodificado por foto, hasta 40 a la vez y se liberan tras 60 s sin uso | **+12,6 MB de RAM por foto mostrada** (60 fotos de 12 Mpx: 686 → 1 442 MB) [M]; se estabiliza hacia 40 fotos ≈ 0,5 GB más [E] |
| Caché HTTP del navegador (disco) | fotos y fragmentos de vídeo | 8,2 MB tras reproducir el montaje de 90 min [M]; **79 MB tras ver 60 fotos** (cada foto original se guarda) [M]; lo gestiona y recorta el propio navegador |
| IndexedDB (aplicación) | borrador, historial, análisis | 0,2 MB [M] |
| Almacenamiento temporal propio | no hay OPFS ni Cache API ni service worker [código] | 0 |
| Exportación en el navegador | el archivo se monta **entero en memoria** (`BufferTarget`, `fastStart: in-memory`) y luego se copia a un `Blob` | pico del montón de JS = **2,0–2,7 × el tamaño del vídeo** [M]: 58 MB → 160 MB; 181 MB → 477 MB; 362 MB → 732 MB. Velocidad 0,8–0,9 × tiempo real [M] |

## 5. Espacio local al abrir y editar un proyecto de 90 minutos

- **Disco:** ≈ 16 MB de perfil del navegador (8 MB de caché, 0,2 MB de IndexedDB) con el montaje de prueba [M]; hasta 5 MB por foto 12 Mpx visualizada [M]; los vídeos apenas se guardan en disco (8 MB) [M].
- **RAM:** ≈ +0,2 a +0,8 GB sobre un navegador vacío [M].
- **Descarga de red:** la de lo visto (sección 3).
- Para un navegador real con H.264 y GPU: [?] no medido (aquí no hay ese códec).

## 6. Espacio adicional al exportar a 1080p

- **En el navegador (rápido):** RAM ≈ 2–2,7 × el archivo; el archivo de 90 min a 5 Mbit/s es 3,4 GB, a 8 Mbit/s 5,4 GB → **7–15 GB de memoria en una pestaña** [E, extrapolado de 58–362 MB]. Es inviable en la práctica. Tiempo ≈ 110 min en este equipo [E]. Descargar escribe después otros 3,4–5,4 GB en disco [E]. A la Biblioteca solo caben 50 MB (Supabase) o hasta la cuota (R2 sin configurar).
- **Con el motor offline (PC):** vídeo de 90 min lo-fi: salida 652 MB + 82,5 MB de audio AAC + 36 MB de trozos únicos = **≈ 0,77 GB** en disco [M]. Con material 100 % distinto cada trozo se guarda además de la salida final: ≈ 2 × el vídeo final [E]. Memoria: pico **1,1 GB** (Node + FFmpeg) en un render de 90 s [M]; por diseño no crece con la duración, pero no lo medí a 90 min [?].
- **Aviso nuevo en el editor** (solo si el vídeo pesará ≥ 1 GB y se descarga): indica la memoria necesaria y recomienda el «Paquete para renderizar en mi PC». No cambia nada más.

## 7. Qué pasa al cerrar el navegador

- Se pierden: la RAM, los fotogramas y cualquier exportación **no guardada** (por eso se pide confirmación al cerrar mientras exporta).
- Permanecen: la caché HTTP (la limpia el navegador a su criterio), IndexedDB con el borrador (solo si había cambios sin guardar; se borra al guardar con éxito), el historial de deshacer (30 pasos, no se borra solo), los análisis de audio (nunca caducan), claves de localStorage para reanudar subidas (R2: sin caducidad; tus subidas tus: 24 h).
- En R2, las partes de una subida cortada **siguen ocupando espacio** hasta completarla o abortarla: hace falta la regla de ciclo de vida de 7 días (documentada) o la limpieza segura.
- Nada de esto lo borra la aplicación hoy: no he borrado ninguna caché ni dato.

## 8. Límites reales

| Límite | Valor |
|---|---|
| Supabase gratis (plan Free) [D, [precios de Supabase](https://supabase.com/pricing.md)] | 1 GB de archivos, **50 MB por archivo**, 5 GB de salida/mes, 500 MB de base, proyecto pausado tras 1 semana sin actividad |
| Cloudflare R2 [D, [resumen de precios](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/); no he podido abrir la página de Cloudflare] | 10 GB-mes, 1 M de operaciones de escritura y 10 M de lectura gratis al mes, salida gratis; luego 0,015 USD/GB-mes |
| R2 en la aplicación | subida simple hasta 5 GiB, por partes de 32 MiB hasta 10 000 partes (≈ 312 GB); cuota de la aplicación 9 GB (`STORAGE_QUOTA_GB`) |
| Línea de tiempo | 4 h (`MAX_TIMELINE_MS`), clip máx. 120 s (`MAX_CLIP_MS`), sin tope de número de clips (180 clips: 51 KB) |
| Navegador | memoria por pestaña: [?] depende del equipo y del navegador; 2–2,7 × el archivo exportado [M]; cuota de IndexedDB y de caché: [D] la fija el navegador según el disco libre |
| Motor offline | sin límite de duración propio; segmentos ≤ 60 s; RAM ≈ 1,1 GB [M]; velocidad ≈ 7–10 fps con contenido distinto a 1080p en 2 CPU, 30 fps ≥ cuando el trozo se reutiliza [M]; límite real: disco libre y el tiempo |

## 9. Cloudflare R2: qué está preparado y qué no

Listo y probado **contra un servidor S3 simulado** (no contra Cloudflare): URLs firmadas V4 (lectura con rangos, subida simple con tamaño firmado), subida por partes reanudable (probada cerrando Chromium a mitad), cuota compartida, comprobación de propiedad de ruta, informe/limpieza segura de huérfanos y subidas abandonadas, compatibilidad con rutas `r2:` y Supabase a la vez.

**No funciona todavía / sin verificar:** no existe el bucket ni las claves; la regla CORS (exponer `ETag`) y la regla de ciclo de vida no están puestas; la firma de las llamadas de listado (`list-type=2`, `?uploads`) no está comprobada con Cloudflare real; el reproductor y el análisis leyendo de R2 en producción [?]; la limpieza no tiene pantalla. Activarlo exige registrar un método de pago en Cloudflare: **requiere tu autorización**.

## 10. Arquitectura propuesta: editar proyectos grandes con consumo local mínimo

Principio: *el original no baja nunca para editar; solo lo ligero*.

1. **Originales en R2**, metadatos y permisos en Supabase (ya existe el diseño).
2. **Proxies de edición** [propuesta, no implementada: decisión de diseño y de coste de cómputo]: por cada vídeo, una copia de 540p/720p H.264 con fotogramas clave cada 1 s (≈ 1–2 Mbit/s), un póster y una tira de miniaturas; por cada foto, una versión de 1920 px (≈ 300 KB, no 5,4 MB); por cada audio, forma de onda precalculada. Se generan gratis en tu PC con FFmpeg (el motor ya lo tiene) o bajo demanda en el navegador. El editor usa solo proxies; la exportación usa los originales.
3. **Caché local limitada y recuperable**: OPFS/Cache API con tope configurable (p. ej. 2 GB) y expulsión por uso menos reciente, **solo de proxies, miniaturas y análisis** (todo regenerable). Nunca se expulsa un borrador sin sincronizar.
4. **Estado de edición**: el JSON del montaje (51 KB a 90 min; ≈ 0,28 KB por clip, ≈ 140 KB a 4 h [E]) + borrador local + 30 versiones en la nube. Es lo único que debe sobrevivir.
5. **Exportación larga fuera del navegador**: el motor offline (ya hecho). Mejora pendiente: que FFmpeg lea los originales directamente desde enlaces firmados por rangos, en vez de descargarlos antes de empezar [E: factible, sin probar].
6. **Limpieza segura de temporales**, siempre informe primero:
   - borrador local: solo se borra si es idéntico a la copia en la nube;
   - análisis y miniaturas: regenerables, se pueden expulsar por tope;
   - historial de deshacer: de montajes ya inexistentes;
   - R2: huérfanos > 24 h y subidas abandonadas > 7 días (ya implementado, solo por API);
   - carpeta de trabajo del motor: borrar solo trozos que el montaje actual ya no usa (no implementado).
7. **Escala a varias horas**: con proxies, la RAM depende de los 12 vídeos activos, no de la duración (medido: estable de 0 a 89 min); la exportación depende del disco, no de la RAM.

## 11. Revisión técnica del sistema de transiciones

Alcance: `transitionFrame`, `frameAt`, `transitionMsOf`, el cruce de audio, el reproductor y el motor. Sin tocar la interfaz.

**Qué funciona y está verificado [M]**
- Vista previa, exportación en el navegador y motor offline usan el mismo cálculo (`frameAt` + `drawOps`).
- **Fidelidad:** las 16 variantes (fundido a negro y blanco, disolvencia con curva lineal, deslizar en tres direcciones, cortinilla en tres, zoom con intensidad 1 y 2, zoom de salida, desenfoque, destello, corte) coinciden entre el reproductor y el motor al 30 %, 50 % y 80 % (≥ 97 % de la rejilla de 32×18 puntos dentro de ±40 niveles) — `node scripts/looks-test.mjs`.
- Las secciones 24 y 25 del navegador comparan además la exportación rápida con la vista previa, pero solo con disolvencia, cortinilla y deslizar [código de la prueba].

**Problema encontrado y corregido**
- La duración guardada podía superar la del clip que termina o la del que empieza (al acortar o dividir un clip después, «aplicar a todos los cortes», copiar/pegar, órdenes por voz, plantillas, o el constructor de bucle con clips cortos). El deslizador de la interfaz ya lo limitaba, pero el cálculo no: un clip de 1 s con una transición de 1,5 s empezaba al 47 % de su propia transición, con un **salto de imagen** justo después del corte anterior. Ahora `transitionMsOf` aplica la misma regla que el deslizador (nunca más larga que ninguno de los dos clips) para imagen, sonido, vista previa y exportación. Regresión: `tests/transition-limits.test.ts`. Los montajes existentes que tenían ese caso se verán distintos (sin el salto).

**Observaciones sin cambiar (decisiones tuyas)**
1. **Curvas:** la imagen sigue la curva elegida (suave, lineal, entrada, salida) pero el cruce de sonido entre clips es siempre **lineal** en amplitud: en la mitad de la transición el volumen total baja ≈ 3 dB para material distinto. Mejora posible: ganancia de potencia constante. Cambia el sonido, por eso no lo toqué.
2. **Intensidad:** solo afecta a zoom, zoom de salida, desenfoque y destello; disolvencia, deslizar y cortinilla la ignoran [código]. Conviene que la interfaz no ofrezca intensidad donde no actúa [no verificado en la interfaz].
3. **Vídeo entrante:** durante la transición se muestra congelado su primer fotograma si el archivo no tiene material anterior al punto de entrada («asa»); si lo tiene, se reproduce. Es coherente, pero puede sorprender con clips que empiezan en movimiento.
4. **Duración máxima 3 s** en los datos; el deslizador la respeta.
5. Falta una prueba de fidelidad de la **exportación rápida del navegador** con las 12 clases (hoy solo 3).

## 12. Cambios hechos en esta pasada (seguros, sin gasto)

- `transitionMsOf` limitado por los clips vecinos + prueba de regresión.
- Aviso de memoria en el panel de exportación cuando el vídeo descargado pesará ≥ 1 GB (`lib/editor/export-limits.ts`).
- Corrección de mi limpieza de R2: protegía `versions/` solo en la raíz del usuario; las versiones reales viven en `<usuario>/<proyecto>/versions/…` (están en Supabase, no en R2, pero ahora cualquier carpeta `versions` queda protegida).
- `scripts/measure-local.mjs` (+ `tests/browser/measure.harness.ts`): las mediciones de este informe se pueden repetir (`--only photos` para la prueba de fotos).
- Prueba de fidelidad de las 16 transiciones.
- No se ha borrado ninguna caché, dato ni archivo.
