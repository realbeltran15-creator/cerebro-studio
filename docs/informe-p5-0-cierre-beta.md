# Informe P5.0 — Cierre técnico de la beta y preparación del primer despliegue seguro

Fecha: 2026-11-02 · Rama `fase1-seguridad` · Presupuesto: 0 € · Sin push (los commits siguen locales), sin despliegue, sin proyectos Cloud, sin cambios en Production, Vercel, credenciales, cron ni automatizaciones. Única interacción con Production: un `select` de **solo lectura** sobre `supabase_migrations.schema_migrations` (texto de 3 migraciones); no se leyó ningún dato de usuario.

## 1. Estado final de la beta

La beta (alcance cerrado, exportación solo rápida, guardas de configuración) funciona de extremo a extremo con **Auth, Storage, PostgREST y PostgreSQL reales** en local (P4.9). Con esta fase quedan resueltos los puntos que ChatGPT pidió cerrar antes de desplegar: pruebas de tiempo real separadas, 0 errores de ESLint, migraciones ausentes documentadas y comprobación previa al despliegue que falla cerrado. **No está desplegada ni se despliega sin autorización.**

## 2. Correcciones realizadas

1. **Pruebas de tiempo real separadas** (`BROWSER_SUITE`): `npm run test:browser` (principal: exportación rápida y todo lo que incluye la beta), `npm run test:browser:lab` (tiempo real: renderizador grabado, mezcla de audio grabada y variante «realtime» de la verificación integral) y `test:browser:all`. No se eliminó ni ocultó ninguna prueba: 686 principales + 21 de laboratorio (las 705 anteriores + 1 guarda nueva + «verify: no page errors», que se ejecuta en ambos grupos; ninguna comprobación relajada). El modo tiempo real sigue desactivado en la beta (`REALTIME_EXPORT_ENABLED=false`).
2. **Carrera de repintado de la búsqueda del Editor** (ver §3).
3. **ESLint: 2 errores → 0** (sin desactivar reglas ni suprimir avisos; los 130 avisos son los mismos de antes):
   - `run` usada en el efecto de autoarranque antes de declararse → el efecto llama a `runRef.current`, asignado en un `useLayoutEffect` declarado después de `run` (los efectos de layout corren antes que los pasivos: mismo orden de ejecución y misma función de la misma renderización).
   - Modificación de `pendingDriveRef` desde `sendToDrive` → la escritura pasa por un ayudante declarado antes del efecto que la lee (mismos valores en los mismos puntos).
   En P4.6 y P4.9 reordenar efectos desplazaba o subía los errores; esta vez se evitó reordenar y se usó una indirección mínima. Cambio de **2 líneas de lógica + 3 de declaración** en `render-panel.tsx`.
4. **Migraciones ausentes** (§5).
5. **Comprobación previa al despliegue** (`npm run predeploy:check`, §6) y `vercel.beta.json` (sin cron).
6. **Hallazgo propio corregido en P4.9** (carrera del test del paso 18 del E2E; ver informe P4.9).

## 3. Carrera de repintado del Editor (investigada con evidencia)

Síntoma (1 ejecución de 3 de Chromium en P4.9): `TimeoutError` al pulsar la opción «Recortar / duración» de la búsqueda («element was detached from the DOM, retrying»). Lectura del código: en `ToolSearch`, `onBlur` programa `setTimeout(() => setOpen(false), 150)` que **nunca se cancela**; si el usuario vuelve a enfocar y escribe antes de 150 ms, el temporizador antiguo cierra la lista nueva. Es un defecto real del producto (latente), no del arnés. **Limitación honesta de la evidencia**: añadí una prueba de regresión con clic real + Ctrl+K inmediato y **también pasa sin el arreglo** (no logré reproducir el cierre con la temporización de Playwright), así que **no puedo afirmar que este defecto explique el timeout observado**. Se corrigió igualmente (`cancelClose` en foco, cambio, selección y desenfoque; 6 líneas) y la prueba queda como guarda. Tras el cambio, la suite principal pasó 2 veces seguidas (686/686; antes del cambio, y con el reparto de grupos ya hecho, pasó 1 vez más) sin repetir el timeout; con tan pocas ejecuciones no se puede descartar una causa distinta, por lo que se **mantiene como riesgo abierto de baja probabilidad**.

## 4. Seguridad de configuración (revisión del candidato)

| Requisito | Evidencia |
|---|---|
| No puede conectarse accidentalmente a Production | Guarda de arranque (`instrumentation.ts`): sale con código 1 si la URL/clave Supabase es la de Production, si `VERCEL_ENV=production` o si no se puede verificar; probado en el E2E (paso 21) y en `predeploy:check` |
| Sin secretos | `predeploy:check` escanea los ficheros versionados (claves `sk-`, AWS, JWT literales, claves privadas, tokens GitHub/Slack/Supabase) y los `.env` versionados: **0 hallazgos** (único falso positivo: el vector de prueba público de AWS `…EXAMPLE` en `tests/storage.test.ts`, admitido con una regla exacta, no por archivo) |
| Sin llamadas de pago | Claves de pago prohibidas en el plan de variables; API de proveedores cerrada por alcance de beta (404 `blocked:'beta'`) |
| Sin publicaciones | Solo 4 rutas de API abiertas (lectura/propio); `predeploy:check` rechaza si se abre una ruta de publicación, OAuth, cola, webhook o generación |
| Sin automatizaciones | **Hallazgo:** `vercel.json` define un cron diario (`/api/cron/automations`, 07:00). Solo se ejecuta en despliegues de Production y la ruta está cerrada en la beta, pero la comprobación **rechaza** `vercel.json` y exige desplegar con `--local-config vercel.beta.json` (sin crons). `vercel.json` no se ha modificado |
| Sin claves privilegiadas | Prohibidas por la guarda de arranque y por el plan de variables |
| Sin migraciones automáticas sobre remotos | `predeploy:check` verifica que ningún script de instalación/compilación/arranque, ni la CI, ni `buildCommand` ejecuten migraciones |
| Falla cerrado | Sin `--env`, con fichero inexistente, con `vercel.json` actual, sin `NEXT_PUBLIC_CEREBRO_BETA=private` o ante cualquier excepción → exit 1. 7 pruebas Vitest nuevas (incluida la comprobación de que **no imprime los valores** de secretos) |

Uso: `node scripts/predeploy-check.mjs --env <fichero con las variables planeadas> --vercel-config vercel.beta.json`. No lee Vercel ni Supabase.

## 5. Migraciones (tres presentes en Production y ausentes del repo)

Detalle y ficheros en `supabase/recovered/README.md`. Clasificación:

| Migración | Clasificación |
|---|---|
| `security_and_performance_hardening` (20260916214243) | **Historial original recuperado** (texto íntegro desde `schema_migrations`). Equivalencia estructural: 12 índices, revocación de `handle_new_user` y 10 de 13 políticas ya reflejados en `baseline_live.sql`; **3 políticas (`connections_own`, `publication_jobs_own`, `approvals_own`) fueron sustituidas después por `server_owned_security`** (verificado en el repo), por eso no se pueden reaplicar sobre el estado final: el test lo declara explícitamente |
| `shared_ai_memory_v1` (20260928193119) | **Historial original recuperado** (íntegro). Crea solo el esquema `ai_memory`; no toca `public`; fuera de la beta |
| `ai_memory_v2_shared_handoff` (20260928200258) | **Solo estructura documentada**: contiene `INSERT`/`UPDATE` (datos de memoria de IA ajenos a la app) y no se copió; esquema `ai_memory`, fuera de la beta |

Cambios pendientes de aplicar: las 7 de `supabase/pending/` (sin cambios). **Un entorno nuevo reproduce el esquema de la beta** con `baseline_live.sql` + 7 pendientes + disparador `on_auth_user_created` (verificado desde cero sobre Auth/Storage/PostgreSQL oficiales; `test:schema` incluye ahora `test-recovered-on-baseline.sh`, 7/7). No se modificó Supabase remoto. Nota: las migraciones del repo (`supabase/migrations/`) siguen sin reconstruir el esquema real; el baseline es la vía de reproducción.

## 6. Validación final (serie; este mismo árbol)

| Comprobación | Resultado |
|---|---|
| TypeScript | ✔ sin errores |
| ESLint | ✔ **0 errores**, 130 avisos (los mismos de antes) |
| Vitest | ✔ 1631 correctas, **22 omitidas** (5 archivos), 162 archivos (+7 de la comprobación previa) |
| Build (`next build`, entorno limpio) | ✔ |
| Chromium principal | ✔ **686/686** (2 ejecuciones seguidas tras los cambios de código y 1 antes; en P4.9, con la suite sin dividir: 705/705, abortada, 705/705 → **no se declara estable**, solo «sin fallos en las últimas 3») |
| Chromium laboratorio (tiempo real) | ✔ 21/21 (por separado) |
| PostgreSQL (sustitutos) / PostgREST real sobre baseline | ✔ 64/64 · ✔ 38/38 |
| Baseline limpio, deriva = Production, 7 pendientes sobre baseline, migraciones previas y concurrencia | ✔ |
| Migraciones recuperadas sobre baseline | ✔ 7/7 |
| Comprobación previa al despliegue (plan correcto / plan con Production y claves de pago) | ✔ APTO 7/7 / ✔ rechazado, sin imprimir valores |
| **Auth y Storage oficiales locales** (trayecto `supabase-js`) | ✔ **51/51** |
| **E2E audiovisual, Editor real, servicios oficiales** | ✔ **21/21** (Login → Proyecto → Guion → Storyboard → Importación → Editor → Audio → MP4 → Biblioteca → Logout → Login → Recuperación) |
| FFmpeg/FFprobe (dentro del E2E) | ✔ MP4 H.264 854×480 24 fps + AAC 48 kHz estéreo, 28,03 s, decodificación completa sin errores |
| Trayecto con simulador (regresión) y UI con login real | ✔ 35/35 · ✔ 11/11 |

**Fallidas:** ninguna en la última ejecución. Durante la fase fallaron y se corrigieron: el test de migraciones recuperadas (mi primera versión asumía que todo el hardening era reaplicable) y, en P4.9, el paso 18 del E2E (carrera del test, con evidencia). **Omitidas:** 22 pruebas de Vitest. **No ejecutadas:** Safari/Firefox, Windows (el stack oficial solo se ejecutó en Linux), proyecto Supabase Cloud real (correo, límites de tasa, OAuth), build y despliegue en Vercel, Realtime/imágenes/Studio de Supabase, carga con muchos usuarios, flujo de Drive (requiere Google).

## 7. Limitaciones

- Auth/Storage oficiales compilados desde fuente con desviaciones documentadas (P4.9 §2); backend S3 simulado (moto); sin Kong; correo autoconfirmado.
- La comprobación de la carrera del Editor (§3) no demuestra causa; el flujo de Drive no es verificable localmente: los 2 arreglos de ESLint son equivalentes por construcción y por pruebas de exportación/persistencia/Editor, pero la subida a Drive solo se ha leído, no ejecutado.
- Los 130 avisos de ESLint permanecen.
- Los Preview anteriores de Vercel (de esta rama) usaron variables compartidas con Production; **no se auditó ni se modificó nada en Vercel**.

## 8. Commits pendientes

Local, sin publicar: los 19 commits previos más los de P4.9 y P5.0 (ver `git log origin/fase1-seguridad..HEAD`). `origin/fase1-seguridad` no se ha tocado. Importante: el proyecto de Vercel despliega **automáticamente cada push** de esa rama (hay despliegues de Preview de todos los commits anteriores), con las variables que hoy comparte con Production; por eso el push no debe hacerse a esa rama hasta tener el entorno aislado (§9).

## 9. Requisitos exactos para desplegar (nada de esto está hecho)

1. **Supabase independiente** (gratuito): un proyecto nuevo (el cupo gratuito parece agotado: lo confirma Jesús en el panel; no verificado). Cargar `baseline_live.sql` + 7 pendientes en orden + disparador `on_auth_user_created`; activar Auth correo/contraseña, bucket privado `generated-assets` con las 4 políticas, subida reanudable y límite ≥ 50 MB.
2. **Vercel aislado**: crear un **proyecto Vercel nuevo** (plan gratuito) en lugar de tocar las variables del actual, para no compartir nada con Production. Variables: solo `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (del proyecto nuevo) y `NEXT_PUBLIC_CEREBRO_BETA=private`. Ninguna clave de pago ni privilegiada.
3. **Rama nueva** (p. ej. `beta-privada`) para el push; desplegar con `--local-config vercel.beta.json`.
4. Ejecutar `predeploy:check` con el fichero de variables planeadas (debe dar APTO 7/7) y, tras el despliegue, repetir `npm run test:e2e:editor` apuntando al Preview con datos sintéticos.
5. Beta con lista cerrada de usuarios.

## 10. Plan de reversión

Borrar el proyecto Vercel de la beta y el proyecto Supabase nuevo (o pausarlo): Production no se toca en ningún paso. Código: los commits son locales; si se publicaron en la rama nueva basta borrarla. Esquema: rollback de cada pendiente en orden inverso (probados). Sin migraciones sobre Production, no hay nada que revertir allí.

## 11. Única autorización necesaria para el siguiente paso

**Autorizar la infraestructura aislada de la beta**: (a) un proyecto Vercel nuevo y gratuito, y (b) un proyecto Supabase independiente **solo si Jesús confirma que hay cupo gratuito**, junto con el push a una **rama nueva** `beta-privada` (no a `fase1-seguridad`). Si no hay cupo Supabase gratuito, la alternativa sin riesgo es mantener la beta **local operativa** (stack oficial en Linux; para el PC con Windows de Jesús no está empaquetado ni probado y habría que decidir otra vía).
