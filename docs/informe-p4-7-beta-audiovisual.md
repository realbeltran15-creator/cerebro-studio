# Informe P4.7 — Cierre del recorrido audiovisual y preparación de la beta

Presupuesto: 0 €. Sin push (16 commits previos + el de P4.7 siguen locales), sin deploy, sin migraciones remotas, sin proyectos externos, sin cambios en Production, credenciales, cron ni automatizaciones. Única interacción con Production: `list_migrations` (solo lectura del catálogo, para la tabla de la sección 3).

## 1. Recorrido completo con el Editor real

`npm run test:e2e:editor` (`scripts/local-e2e-editor.mjs`): Next.js real (`next build` + `next start`) + Chromium real + PostgREST real sobre el esquema reconstruido (RLS real). **El MP4 lo produce el Editor** (RenderPanel → exportación rápida WebCodecs) en el navegador; el test solo hace clic en «Renderizar y guardar» y después comprueba el resultado con FFprobe/FFmpeg. No hay ninguna función de prueba que genere el vídeo.

19/19 comprobaciones, repetidas 4 veces seguidas (2 durante el desarrollo, 1 en la validación final con build limpio y secreto aleatorio): sin fallos.

| # | Paso (todo por la interfaz salvo el alta de las 2 cuentas) | Evidencia |
|---|---|---|
| 1 | Login | cookies reales de `@supabase/ssr` |
| 2 | Proyecto (/projects) | visible tras crear |
| 3–4 | Guion v1 con texto → «Convertir en storyboard» | 8 escenas en BD |
| 5 | Subida en /library de 2 MP4 (H.264/AAC), 1 PNG | 3 assets con `storage_path`; bytes idénticos a los originales |
| 6 | Editor: asigna medios a 3 escenas, «Guardar montaje» | borrador con `visualAssetId` |
| 7 | «Abrir en el Editor manual» | sin errores de página ni peticiones fallidas |
| 8 | Importar un WAV con el Centro de importación (subida resumable TUS) | audio en BD |
| 9–10 | Música de fondo + «Guardar ahora» | música presente en la composición guardada |
| 11 | Exportar: rápido, 480p, 24 fps, destino «Biblioteca de Cerebro Studio» | job `completed` en ~10 s |
| 12 | FFprobe: `mov,mp4`, **H.264 854×480 24 fps + AAC 48 kHz estéreo, 28,03 s** (montaje: 28,00 s); `ffmpeg -f null` decodifica todo sin error | |
| 13 | Contenido: luma 82 en t=1 s (imagen real), 0 en t=26 s (escenas vacías = negro, aviso previo aceptado), volumen medio −27,8 dB | |
| 14 | Aparece en la Biblioteca; descarga por URL firmada = mismos bytes (1 360 646) | |
| 15 | «Cerrar sesión»: /editor/manual vuelve a /login | |
| 16 | Nuevo login + reapertura: 8 clips, 3 con medio, música, exportación `completed` conservados | persistencia |
| 17 | Segundo usuario: no ve el proyecto, el montaje (no carga) ni los medios; `signed-url` del MP4 ajeno → 404 | aislamiento |
| 18 | Un medio desaparece del almacenamiento: la exportación **falla con aviso** («Una imagen del montaje no se pudo cargar. [fase: vídeo · id xxxxxx]»), job `failed`, 0 vídeos nuevos | recuperación |
| 19 | Se restaura el medio: la misma exportación se completa (8 s) | |

Hallazgos del E2E (todos del *sustituto*, no del producto): el Storage simulado guardaba el sobre multipart (el producto subía bien; la imagen no decodificaba) → ahora desempaqueta multipart, sirve `content-type` y `Range`; no implementaba TUS (usado por el Centro de importación) → TUS mínimo añadido. Ningún defecto del Editor salió a la luz.

### Qué es real y qué es simulado
- **Real**: aplicación Next.js, navegador, Editor, WebCodecs/MediaRecorder, PostgreSQL 16 con el esquema reconstruido, PostgREST 12.2.3 (RLS), FFmpeg/FFprobe, `supabase-js`/`@supabase/ssr`.
- **Simulado** (`scripts/local-supabase-lite.mjs`, no es Supabase): Auth (alta, login, refresh, logout; JWT HS256; sin confirmación por correo, OAuth, MFA, límites de tasa ni revocación), Storage (REST, URLs firmadas, Range, TUS mínimo; la regla «solo tu carpeta `uid/`» está reimplementada en código, **no** es la RLS de `storage.objects`; sin transformaciones, caducidad de TUS ni cuotas), sin Realtime. Los medios son sintéticos (ffmpeg). Las cuentas se crean con el cliente real; el alta por interfaz no se ejerce en este E2E.
- **No cubierto**: Safari/Firefox (solo Chromium), vídeos largos o de 1080p/4K en este E2E, Drive/Dropbox/carpeta, dispositivos móviles, generación con IA (desactivada).

## 2. Exportación en tiempo real

**Causa (medida, P4.6 + P4.7)**: el modo tiempo real avanza con el reloj de pared (`performance.now()`), no con el tiempo del proyecto, y graba lo que el navegador alcanza a pintar. Con la CPU saturada los fotogramas llegan tarde o repetidos y, a mitad de una transición, la imagen exportada puede diferir de la vista previa. No depende de datos ni de la lógica de montaje. Reproducido: aislado y limpio 0/10; en el orden de la suite 8/8; con 2 núcleos saturados 5/8 fallos; falló en 2 de 5 suites completas en la VM de 2 CPU. El modo rápido (fotograma a fotograma, tiempo del proyecto) fue exacto 8/8 siempre.

**Decisión**: no se sube ningún timeout ni se relaja ninguna prueba. El modo **rápido ya es el predeterminado** (`mode ?? 'fast'`) y es el camino fiable (en el E2E, 28 s de vídeo en ~10 s). El modo tiempo real se conserva como alternativa y como respaldo cuando el rápido no es compatible, pero ahora **mide su propia calidad** (`lib/editor/frame-quality.ts`: fotogramas tardíos, huecos máximos, trabajo por fotograma) y, si detecta saltos, muestra un aviso en el panel («…saltos… usa el modo rápido»); el panel también explica en una línea que el rápido es exacto.
- Calibración con carga artificial (`scripts/browser-repeat-verify.mjs`, limpia / ×2 / ×4 de CPU): **0 exportaciones distintas sin aviso** (el aviso saltó también en ~2/8 casos que resultaron iguales: conservador a propósito).
- Suite: en modo rápido la comprobación «igual que la vista previa» es estricta; en tiempo real exige «igual **o** avisado» (nunca diferente en silencio). Es una garantía de detección, **no** de determinismo: **el tiempo real sigue sin ser determinista en equipos lentos**. Estado: mitigado y detectable; no eliminado. Dejarlo deshabilitado por completo sería la opción más segura si la beta no lo necesita (decisión pendiente, ver sección 6).

## 3. Esquema reproducible

- `supabase/schema/baseline_live.sql` y las instantáneas se generan **solo del catálogo** (estructura). Nuevo `scripts/check-baseline-clean.sh` (en `npm run test:schema`) falla ante: INSERT/COPY de nivel superior (salvo la fila del bucket privado `generated-assets`), UUID, correos, formas de JWT/clave, URLs, el ref de Production o valores por defecto largos. Resultado: limpio; control negativo (fila inyectada) → falla. Los únicos `insert` restantes están dentro de cuerpos de funciones (definiciones).
- Migraciones (Production consultado en solo lectura; no se inventa ni se marca nada como aplicado):

| Production (15 aplicadas) | Repositorio (12) | Estado |
|---|---|---|
| 20260916205131 initial_cerebro_studio_schema | igual | idéntica |
| 20260916205142 production_workflow_schema | igual | idéntica |
| 20260916214243 security_and_performance_hardening | — | **falta en el repo** |
| 20260917200138 generated_assets_storage | 20260917190000 | otro timestamp |
| 20260926151554 scripts_module | 20260926120000 | otro timestamp |
| 20260926191951 automations | 20260926190000 | otro timestamp |
| 20260926222420 trend_snapshots | 20260926230000 | otro timestamp |
| 20260927140854 virtual_influencer_studio | 20260927150000 | otro timestamp |
| 20260928193119 shared_ai_memory_v1 | — | **falta en el repo** |
| 20260928200258 ai_memory_v2_shared_handoff | — | **falta en el repo** |
| 20261007213359 opportunities_unique_source | 20261007120000 | otro timestamp |
| 20261010101951 shorts_factory | 20261010120000 | otro timestamp |
| 20261013120000 research_cache | igual | idéntica |
| 20261015120000 campaigns | igual | idéntica |
| 20261018120000 server_owned_security | igual | idéntica |

Propuestas (7, en `supabase/pending/`, **no aplicadas en Production**): job_queue (20261101120000), storyboard_from_script_rpc, scenes_concurrency_and_reorder, subtitle_unique_per_source, transcription_locks, reserve_generation_spend, research_functions_search_path (20261102120000–170000). Cada una con su `rollback.sql`; aplicadas, idempotentes y revertidas sobre el baseline: 30/30 pasos. El baseline es una referencia de estructura, **no** una fuente automática de cambios para Production. Detector de deriva conservado y activo (`test-schema-drift.sh baseline|repo`).

## 4. ESLint

3 errores → **2** (`render-panel.tsx`). Corregido: `Math.random()` en el id de diagnóstico de cada exportación (solo aparece en el mensaje de fallo y en `console`) → `crypto.getRandomValues`; sin cambio funcional, y el E2E (paso 18) comprueba el formato del id en el mensaje de error. Quedan: (145) `run` usado en el efecto de autoarranque antes de declararse y (420) `pendingDriveRef` modificado en `sendToDrive`/efecto. Ambos tocan el flujo de subida a Drive y el autoarranque; no hay pruebas de comportamiento que los cubran (Drive no está disponible en local), así que **no se tocan**. 2 errores / 126 avisos en total en el proyecto; ninguna regla desactivada.

## 5. Validación final (serie, máquina limpia, Chromium detrás de todo lo demás)

**Pasan**: TypeScript sin errores · Vitest 1602 correctas (159 archivos) · build en entorno limpio · PostgreSQL local 64/64 · PostgREST real sobre el baseline 38/38 · instantáneas sin datos/secretos · deriva baseline = Production (columnas y recuentos) · 7 pendientes sobre baseline 30/30 · cadena de migraciones y concurrencia · trayecto de datos autenticado 35/35 · UI con login real 11/11 · **E2E del Editor 19/19** · suite Chromium **704/704** (FFmpeg/FFprobe usados dentro del E2E).
**Fallan**: ninguna comprobación en esta ejecución final.
**Omitidas**: 22 tests de Vitest (5 archivos) con motivo propio (S3/entornos externos); en P4.5 S3 con moto: 2 omitidas.
**No ejecutadas**: Auth/Storage/Realtime reales de Supabase; navegadores distintos de Chromium; exportación a Drive/Dropbox/carpeta; generación con IA; pruebas de carga/concurrencia con muchos usuarios; build en Vercel; accesibilidad automatizada.
Nota de honestidad: la suite Chromium fue 704/704 aquí, pero históricamente ha dado 703/704 de forma intermitente (3 causas distintas, ver P4.6 §2; una era un defecto real ya corregido). No la presento como estable al 100 %.

## 6. Riesgos y bloqueantes de la beta

Seguridad: (1) Auth/Storage solo simulados: la RLS de `storage.objects` y la protección de las URLs firmadas no se han probado contra Supabase real; (2) en Vercel las variables de Supabase y las claves de servicio/pago siguen **compartidas entre Production y Preview** (P4.5): un Preview hoy escribiría en Production; (3) las 7 migraciones propuestas no están en Production; (4) 3 migraciones de Production no están en el repo (solo su efecto estructural); (5) 2 errores ESLint en el flujo Drive/autoarranque.
Bloqueantes de una beta privada: A) entorno Supabase independiente (plan/cupo por confirmar; Preview sin claves de servicio ni de pago, con la guarda de «ref de Production»); B) aplicar las 7 pendientes allí y repetir el E2E contra Auth/Storage reales (puede hacerse gratis con el stack oficial local de Supabase/Docker en el PC de Jesús); C) decidir si el modo tiempo real se desactiva en la beta; D) navegadores objetivo (Chromium validado; Safari/Firefox no).

## 7. Plan de despliegue y reversión (propuesto; nada ejecutado)

1. Autorización explícita de Jesús; confirmar plan/cupo de Supabase. 2. Crear proyecto «cerebro-preview» (o stack local oficial primero). 3. Cargar `baseline_live.sql` + 7 pendientes en orden; verificar RLS en todas las tablas y 2 usuarios sintéticos. 4. En Vercel, variables **solo de alcance Preview** (URL y clave publicable del proyecto nuevo); retirar de Preview service role, claves de pago y secretos de cron/OAuth. 5. Publicar (push) los commits locales a una rama, deploy de Preview. 6. Repetir `test:e2e:editor` apuntando al Preview con datos sintéticos. 7. Beta privada con lista cerrada. **Reversión**: borrar variables de Preview, pausar/borrar el proyecto nuevo (sin coste), y cada migración tiene su `rollback.sql`; Production no se toca en ninguno de los pasos.

## 8. Autorización necesaria a continuación

(a) Crear un proyecto Supabase independiente o instalar/usar el stack local oficial (Docker) en el PC de Jesús; (b) push de la rama (17 commits locales) hacia un Preview; (c) cambiar variables de Vercel solo de alcance Preview; (d) decisión sobre desactivar el modo tiempo real en la beta. Sin estas autorizaciones no se hace nada de lo anterior.

## 9. Commits de la fase

Un único commit local de P4.7 (E2E del Editor, medidor de fidelidad de la exportación en tiempo real, comprobación de instantáneas limpias, Storage simulado con multipart/Range/TUS, ESLint 3→2).
