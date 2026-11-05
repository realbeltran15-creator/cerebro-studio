# Informe P5.10 — Flujo audiovisual completo y aislamiento entre usuarios (0 €)

Entorno: app compilada con la beta desactivada, Auth/Storage/PostgREST oficiales en local, Chromium real, FFprobe/FFmpeg, datos sintéticos, `CEREBRO_STOCK_FIXTURE=1`. Prueba: `npm run test:e2e:modules` → **34 correctas, 0 fallidas** (pasos M26–M29 nuevos).

## 1. Flujo completo (M26, M27)
Desde la interfaz, con el usuario A: proyecto → material sintético buscado e importado a la Biblioteca (M25) → montaje guardado como plantilla → plantilla con ese material en los 3 huecos visuales (el selector lo ofrece por ser imagen) → «Abrir en el editor manual» (transición Plantillas → Editor comprobada) → música local (WAV de 523 Hz importado con el Centro de importación y elegido) → «Guardar ahora» (BD: 3 clips + `musicAssetId`) → exportar a Biblioteca.
Evidencia del MP4 descargado del almacenamiento: H.264 854×480, AAC, duración 27,03 s (esperada 27), decodificación completa sin errores, volumen medio −21,4 dB (hay audio audible), y el fotograma a los 2 s es rojizo (RGB 188,48,65), es decir, procede de la imagen importada (200,60,60 antes de la conversión de color), no de un fondo negro.
Persistencia: se cierra el contexto, se entra de nuevo por la interfaz y se comprueba que el proyecto aparece, el resultado está en la Biblioteca y su URL firmada devuelve `200 video/mp4` (813 KB). La exportación en tiempo real sigue desactivada.

## 2. Seguridad con dos usuarios (M28)
Usuario B (sesión real) contra los datos de A:
- Importar en el proyecto de A → 404; leer la URL firmada de un material de A → 404; ídem del MP4 resultado → 404; usar el id de un material de A como identificador de importación en un proyecto propio → 502 (no encontrado), sin datos.
- Ninguna respuesta de error contiene el id del proyecto, el propietario, el nombre del proyecto, el correo de A ni la ruta de almacenamiento.
- Con el cliente real de Supabase: B no lee, no modifica, no borra filas de A, no descarga ni obtiene URL firmada ni borra el objeto de almacenamiento de A; el activo de A queda intacto.
- A conserva sus permisos: firma sus archivos (200) e importa en su proyecto (201).
Limitación: se probó con un par de usuarios y las rutas `stock/import` y `assets/signed-url`; no se recorrieron todas las rutas de la API.

## 3. Idempotencia y concurrencia (M29) — defecto encontrado y corregido
Seis importaciones simultáneas del mismo elemento: **no había duplicados ni archivos huérfanos**, pero 5 de las 6 respuestas eran `502 «The resource already exists»` (la ruta de almacenamiento es determinista y el segundo `put` fallaba). Corrección mínima en `lib/providers/persist.ts`: si el fallo es «ya existe», se espera (hasta 5 s) al registro de la solicitud ganadora y se devuelve como duplicado. Tras la corrección: respuestas `200,201,200,200,200,200`, 1 activo, 0 huérfanos. Importar el mismo elemento en otro proyecto del mismo usuario crea su propio activo (1) y ninguna ruta cruza proyectos. Regresión: M29 exige exactamente un 201 y ningún error + `tests/import-concurrency-guard.test.ts`.

## 4. Validación
tsc 0 errores; ESLint 0 errores; Vitest 1648 correctas (22 omitidas); E2E módulos 34/34; Chromium principal 686/686.

## 5. Límites honestos
La importación usa imágenes sintéticas (no hay vídeo sintético ni Pexels real); la música es un tono; no se probó importación concurrente entre usuarios distintos ni con carga alta; el resto de rutas de la API no se auditó en este informe.
