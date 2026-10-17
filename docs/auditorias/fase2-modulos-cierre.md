# Fase 2: cierre de módulos sin coste · sobre `fase1-seguridad` · 17-10-2026

Implementado por Claude (Cowork). Se entrega como parche porque esta sesión no puede hacer push. **No se ha usado cuota real, no se ha gastado nada, no se ha publicado nada, no hay migraciones y no se han tocado ni Producción ni la Preview.**

## Comprobaciones locales

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | Sin errores |
| `vitest` | 842 correctas y 13 omitidas (pruebas de integración que necesitan credenciales). 0 fallos. |
| `node scripts/browser-tests.mjs` (Playwright con mocks) | 331 comprobaciones correctas |
| ESLint | 0 errores |

La copia local tiene ahora instaladas las dependencias de desarrollo de `@ffmpeg`, por eso ya pasa la prueba `vendored-ffmpeg` que fallaba en la fase 1.

## Seguridad

- **Límite de frecuencia en el servidor** (`lib/security/rate-limit.ts`). Se aplica por usuario y por ruta:

  | Ruta | Límite |
  |---|---|
  | `studio/generate` | 20/min |
  | `transcribe` | 10/min |
  | `scripts/assist` | 20/min |
  | `recreate/analyze` | 6/min |

  - Si se supera, responde 429 con `Retry-After`.
  - Es una ventana deslizante en memoria de cada instancia. Protege contra dobles clics y bucles, pero no es un límite global: el tope de gasto de la fase 1 sigue siendo la barrera de dinero.
- **Publicaciones interrumpidas** (`youtube.ts` y `social.ts`):
  - Un trabajo que lleva más de 30 min en «publishing» vuelve a `approved` con `interruptedAt` y **no se reintenta solo**.
  - El usuario recibe un 409 que le pide comprobar en la plataforma si el vídeo llegó a subirse antes de reintentar, para evitar publicaciones duplicadas.
  - Si el trabajo lleva menos de 30 min, responde «ya está en curso».
- **Automatizaciones** (`lib/automations/run.ts`):
  - No se lanza una ejecución mientras otra de la misma automatización sigue activa.
  - Las ejecuciones colgadas más de 15 min se marcan como fallidas.

## Creación

- Los modelos que no se han probado de verdad aparecen como **«NO VERIFICADO»** en el directorio de proveedores y en el Estudio.
- La persistencia de trabajos y los topes de gasto se hicieron en la fase 1.
- **Personajes y avatares: no se ha hecho.** Necesita un proveedor de pago y una prueba real.

## Editores y Shorts

- **Plantillas de edición** (`lib/editor/templates.ts`):
  - Hay 4 plantillas incluidas.
  - Se pueden guardar plantillas propias en `connector_configs` (provider `cerebro-editor`, capability `edit_templates`). Es una tabla existente con RLS, así que **no hace falta migración**.
  - La sección «Plantilla» del editor permite aplicarlas.
- **Exportar subtítulos .srt y .vtt** desde el panel de render, con la misma sincronización que el vídeo renderizado, y «Descargar SRT» en la Biblioteca para los subtítulos transcritos.
- **Vídeo largo a Shorts** (`lib/shorts/extract.ts` y `app/repurpose/long-video.tsx`):
  - A partir de la transcripción, propone tramos de 15–30, 20–58 o 30–90 s.
  - Puntúa con un cálculo, no con IA: gancho al inicio, frases completas, ritmo de voz, silencios y conectores. Explica cada elección.
  - «Crear Short» guarda un borrador 9:16 con subtítulos y gancho, que se abre en el editor manual.
  - No renderiza ni publica nada por sí solo.

## Biblioteca

- **Subida directa**: archivo, tipo, proyecto, título, licencia y progreso.
- **Paginación** de 120 en 120, con «Cargar más». Antes había un tope fijo de 500.
- **Borrado seguro** (`deletionCheck`):
  - Se bloquea si una publicación usa el archivo.
  - Si es el resultado de un montaje o tiene derivados, solo avisa.
  - Pide confirmación en la propia página y vuelve a comprobar las referencias justo antes de borrar.
  - Primero borra la fila y después el archivo, así no quedan filas que apunten a archivos inexistentes.

## Publicación

- **YouTube programado**: el campo opcional «Programar» usa `status.publishAt` nativo.
  - Se sube como privado y YouTube lo publica a la hora indicada.
  - La hora debe estar entre 15 min y 6 meses en el futuro.
  - Forma parte del payload sellado: cambiar la hora después de aprobar invalida la aprobación.
- **Instagram y TikTok**: se mantienen preparación y aprobación. Publicar de verdad requiere credenciales y revisión de las apps.

## Pendiente de validación real (necesita autorización)

1. Aplicar los parches y desplegar en Preview (Code o acceso de push para esta sesión).
2. En Preview, probar el sello, el tope con `GENERATION_DAILY_CAP_USD=0`, la subida y el borrado en la Biblioteca, y el flujo de Shorts con un vídeo ya transcrito.
3. Subida privada de prueba a YouTube con `publishAt` (cuota de YouTube).
4. Una investigación real con el motor 7.
5. Migración de `research_cache` y endurecimiento RLS (SQL en `fase1-seguridad-y-r1.md`).
6. Presupuesto para probar proveedores de generación de pago.
7. Credenciales de Meta y TikTok.
