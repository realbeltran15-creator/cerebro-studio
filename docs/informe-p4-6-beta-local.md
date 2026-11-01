# Informe P4.6 — Reproducibilidad, estabilidad y beta local

Presupuesto: 0 €. No se ha hecho push, deploy, migración remota, cambio de variables, proyecto externo ni modificación de Production. La única interacción con Production fue de **solo lectura sobre el catálogo del sistema** (estructura: columnas, restricciones, índices, políticas, funciones, grants y la lista de migraciones aplicadas). No se leyó ninguna fila de datos de usuario, ni claves, ni secretos.

## 1. Reconstrucción del esquema

**Estado: reproducible.** `supabase/schema/baseline_live.sql` (generado por `scripts/gen-baseline.py` a partir de tres instantáneas de estructura versionadas: `live-columns.txt`, `live-constraints.txt`, `live-other.sql`) reconstruye en un PostgreSQL desechable las 29 tablas de `public`, 150 restricciones, 87 índices, 36 políticas (32 de `public` + 4 de Storage), 6 funciones, 9 disparadores, el bucket privado `generated-assets` y los grants de tabla/función. `scripts/test-schema-drift.sh baseline` compara columnas (nombre, tipo, nulabilidad) y recuentos de objetos contra la instantánea de Production y **falla ante cualquier diferencia futura** (hoy: coincide).

Las 7 migraciones pendientes se aplican sin error sobre este baseline, son idempotentes y reversibles (`scripts/test-pending-on-baseline.sh`, 30 pasos). Esto resuelve el bloqueo de P4.5: la migración `subtitle_unique_per_source` dependía de `assets.asset_type`, que la cadena del repositorio no creaba.

### Diferencias encontradas (repositorio ↔ Production)

- Production tiene **15 migraciones aplicadas**; el repositorio tiene 12. Faltan en el repo `security_and_performance_hardening`, `shared_ai_memory_v1` y `ai_memory_v2_shared_handoff`. Los 12 nombres existen en Production, pero 7 tienen otra marca de tiempo (p. ej. repo `20260917190000` ↔ Production `20260917200138`).
- Las 12 del repo **no reconstruyen** el esquema real: 14 tablas difieren en columnas. Ejemplos: `assets` (repo `kind`/`metadata`; Production `asset_type`/`provenance`/`license_status`/…), `approvals`, `audit_log`, `channel_connections` (repo `platform`; Production `provider` + cifrado de tokens), `connector_configs`, `metric_snapshots`, `opportunities` (falta `source_id`), `projects`, `publication_jobs`, `render_jobs`, `scenes`, `storyboards`, `profiles`; y `generation_spend` no existe en la cadena del repo. El detalle exacto está en `supabase/schema/known-drift-repo.txt` (`scripts/test-schema-drift.sh repo`).
- Las tablas de memoria de IA de las migraciones `shared_ai_memory_*` no aparecen en `public` en Production (no se investigó si viven en otro esquema o se eliminaron).

### No reconstruido / limitaciones

El disparador sobre `auth.users` que llama a `handle_new_user()` pertenece al esquema `auth` (gestionado por Supabase): el test local lo añade a mano. No se reproducen extensiones, ajustes de Auth, configuración de Storage (límites, tipos MIME) ni el contenido exacto de las 3 migraciones faltantes. Las instantáneas deben regenerarse tras cualquier cambio de esquema en Production (instrucciones en el encabezado de los ficheros). El baseline es para bases desechables o locales; **no debe ejecutarse contra Production**.

## 2. Estabilidad de Chromium

Cinco ejecuciones completas de 704 comprobaciones: 703, 703, 703, 703 y 704; los fallos fueron tres comprobaciones distintas (renderer audio, analysis worker y, dos veces, real-time vs vista previa). Se aislaron y repitieron (`scripts/browser-repeat.mjs`, `scripts/browser-repeat-verify.mjs`).

| Fallo | Clasificación | Evidencia |
|---|---|---|
| `analysis worker: progress… cancelled run stops` | **Defecto del producto (corregido)** | Sin el arreglo: 6/15 fallos en máquina limpia. Con el arreglo: 0/15 (también 0/15 con carga). Causa: el worker no pasaba `yieldEveryMs`, así que nunca cedía al bucle de eventos y el mensaje `cancel` no se leía hasta terminar; la cancelación solo funcionaba por azar. Arreglo: `yieldEveryMs: 20` en el worker y comprobación de aborto antes de la detección de pulsos. |
| `renderer: linked voice only in its clip` | **Entorno** (no reproducido) | 0/15 en aislado, 0/15 con 2 núcleos saturados y 0/10 con 6 procesos. Apareció una vez durante un `next build` simultáneo en una máquina de 2 CPU. |
| `verify (realtime): export = preview` (instantes a mitad de transición) | **Limitación del modo tiempo real bajo carga de CPU** (riesgo P2 abierto, ahora reproducido; no es un defecto de datos, es de temporización) | Aislado en máquina limpia: 0/10, y 8/8 repitiendo el orden exacto de la suite (reproducción → exportación rápida → tiempo real en la misma página). Con 2 núcleos saturados: 5/8 fallos, siempre en los instantes 7 y 8, a mitad de transición. Modo rápido (exacto por fotograma): 8/8. Dentro de la suite completa, en una VM de 2 CPU, falló en 2 de 5 ejecuciones (la carga de Chromium sola llega a 3,07 sobre 2 núcleos). |

Incidencia propia, registrada por transparencia: un fallo de mi script de repetición dejó dos procesos de carga huérfanos durante ~1 h y contaminó mediciones intermedias (incluida una ejecución completa). Se detectó, se mató, se hizo el script resistente (`process.on('exit')`) y se **repitieron en máquina limpia** las mediciones usadas en este informe. No se subieron timeouts ni se redujo cobertura.

Recomendación de producto (no aplicada): el modo en tiempo real depende del reloj y pierde exactitud si el equipo está saturado; ya hay aviso en la interfaz, pero conviene que el modo rápido sea el predeterminado.

## 3. Beta local autenticada: viabilidad

**Viable y de bajo mantenimiento para el recorrido de datos; no sustituye a Supabase Auth/Storage reales.** Implementado:

- `scripts/local-supabase-lite.mjs`: una pasarela HTTP (~170 líneas) que expone `/rest/v1` → **PostgREST real** sobre el esquema reconstruido (RLS real), `/auth/v1` → **Auth simulado** (alta, login con contraseña, refresh, `user`, `logout`; JWT HS256) y `/storage/v1` → **Storage simulado** sobre un directorio temporal (subida, descarga, listado, borrado, URLs firmadas de descarga y subida). La regla «solo tu carpeta `uid/`» se reimplementa en código, **no** es la RLS de `storage.objects`.
- `scripts/test-local-journey.sh` + `local-journey.mjs` (35 comprobaciones, cliente `@supabase/supabase-js` real): alta y login → proyecto → guion → storyboard (RPC) → escenas → subida del MP4 → biblioteca → render job → cierre de sesión → reapertura con persistencia y bytes idénticos → URL firmada → aislamiento entre dos usuarios y anónimo → borrado en cascada. 35/35.
- `JOURNEY_SCRIPT=local-ui-smoke.mjs` (`npm run test:journey:ui`): `next build` + `next start` reales apuntando al stack local y Chromium real: redirección de rutas protegidas, login por la interfaz con cookies reales de `@supabase/ssr`, y 5 páginas autenticadas sin errores 5xx. 11/11.

**Limitaciones que hay que decir expresamente:** Auth es simulado (sin confirmación por correo, OAuth, límites de tasa, MFA ni revocación); Storage es simulado (sin RLS real, subidas reanudables ni transformaciones); no hay Realtime. El tramo Editor → exportación MP4 en la aplicación real aún no se recorre dentro de este stack: lo cubren la suite Chromium (con Supabase simulado) y las pruebas de exportación; unirlos exigiría sembrar un proyecto con medios reales y automatizar el editor, estimado en una sesión más. Los tokens no son de Supabase: **no se debe presentar esto como prueba de Supabase Auth.**

## 4. ESLint

De 12 errores en P4.5 a **3** (en total, desde el inicio de P4.5: 12 → 3). Corregido ahora: `editor-timeline` (la asignación a `document.body.style.userSelect` pasa por una función a nivel de módulo; misma operación, mismo orden). Quedan 3 en `render-panel.tsx` (líneas ~142, ~242, ~416): la heurística del React Compiler considera que `run` (la exportación) se invoca desde un efecto declarado antes de ella. Mover el efecto solo trasladó los errores a otras líneas y se revirtió; arreglarlos exige reestructurar el flujo de exportación MP4. **No se puede demostrar sin riesgo que el comportamiento queda idéntico, así que no se tocan.** Las reglas de ESLint y de seguridad siguen intactas. Avisos: 124 (3 de ellos nuevos son de scripts de prueba ya limpiados).

## 5. Pruebas realmente ejecutadas (máquina limpia, en serie)

TypeScript sin errores · Vitest 1590 correctas / 22 omitidas (158 archivos) · build en entorno limpio correcto · PostgreSQL local 64/64 · PostgREST real sobre el baseline reconstruido 38/38 (antes sobre un sustituto hecho a mano) · esquema reconstruido = Production (columnas y recuentos) · 7 pendientes sobre baseline, 30/30 pasos · migraciones previas y concurrencia correctas · trayecto local autenticado 35/35 · interfaz con login real 11/11 · suite Chromium completa **704/704** en la última ejecución (con muestreo de recursos), sin arreglos adicionales respecto a las que dieron 703/704; la comprobación tiempo real↔vista previa sigue siendo intermitente en esta VM de 2 CPU (ver §2). Resultado final **no determinista**, no lo presento como estable.

## 6. Bloqueantes restantes

1. Para validar Auth y Storage **reales** hace falta un proyecto Supabase independiente o el stack local oficial (GoTrue/Storage no obtenibles en esta sandbox). Sin decidir aún; el cupo gratuito probablemente está agotado.
2. Las 3 migraciones de Production ausentes del repositorio no se han recuperado (solo su efecto estructural).
3. 3 errores ESLint en la exportación MP4 y el modo tiempo real sensible a la carga.
4. Los 15 commits locales siguen sin publicar (según orden).

## 7. Recomendación operativa

No crear proyectos ni publicar todavía. Siguiente paso de mayor valor, todo local: (a) fijar el modo rápido como predeterminado y añadir al aviso de tiempo real la causa (carga de CPU); (b) recorrer Editor → MP4 → Biblioteca dentro del stack local (sembrado sintético); (c) decidir con Jesús si merece la pena el stack oficial local de Supabase en su PC (Docker) para validar Auth/Storage reales sin coste, antes de plantear un entorno externo. Ruta de despliegue segura mínima: partir de `baseline_live.sql` para cualquier base nueva, aplicar las 7 pendientes en orden y solo entonces conectar un Preview con variables propias.
