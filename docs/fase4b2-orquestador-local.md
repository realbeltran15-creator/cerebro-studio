# Fase 4B.2 — Orquestador local integrado en modo simulación

Estado: código + pruebas locales. **Sin push, sin despliegue, sin migraciones en Supabase, sin cron, sin tocar automatizaciones, sin credenciales, sin servicios de pago.** Coste real: 0 €. Rama `fase1-seguridad` (commits locales sobre `0497f75`).

## 1. Arquitectura implementada

```
npm run queue:simulate ─► assertLocalOnly (rechaza env de Production / host remoto / dry_run=false)
        │                     └► PostgreSQL 16 desechable (socket unix /tmp, sin red) + migración pendiente
        ▼
 runOnce (lib/queue/executor.ts)  ◄── QueueStore / ledger sobre RPC (lib/queue/rpc-adapter.ts)
   claim(kinds) → por paso: cancelación → dry_run → aprobación → presupuesto → run(timeout) → conciliar
        │                                   └► SOLO funciones SQL verificadas (rol service_role)
        ▼
 Trabajo `video_production` (lib/queue/simulation): script → storyboard → montage → [generate_assets*] → render
        → qc → prepare_publication → [publish*]          (* irreversibles: saltados en dry_run)
        render = MP4 de prueba generado con ffmpeg · qc = ffprobe/ffmpeg REALES (lib/qc/media.ts)
```

- **Adaptador `QueueStore`/ledger por RPC** (`lib/queue/rpc-adapter.ts`): solo llama a funciones `SECURITY DEFINER` (`enqueue_job`, `claim_next_job`, `heartbeat_job`, `save_job_steps`, `finish_job`, `request_cancel_job`, `resume_job`, `grant/revoke/get_approval`, `reserve_budget_multi`, `settle/release/mark_uncertain/resolve_uncertain`, `budget_used`). No hay SQL suelto, así que el mismo adaptador servirá con `supabase.rpc()` en 4B.3. Se prueba contra PostgreSQL local con el rol `service_role` (mínimo privilegio), no solo con mocks.
- **SQL ampliado** (`supabase/pending/…job_queue.sql`, sigue sin aplicarse en ningún Supabase): 10 funciones RPC nuevas, `reserve_budget_multi` (todo-o-nada entre unidades, orden fijo de locks sin interbloqueos) y filtro `p_kinds` en `claim_next_job` (un worker no reclama tipos que no sabe ejecutar). Rollback actualizado y probado.
- **Ejecutor**: ahora asíncrono (memoria o PostgreSQL), con `hold` (el paso termina bien pero el trabajo espera a una persona), trazabilidad por paso (`startedAt`, `durationMs`, `dependsOn`) y cancelación cooperativa vía `ctx.isCancelled()`.
- **QC real** (`lib/qc/media.ts`): `ffprobe` (códec, duración, resolución, FPS, flujos), decodificación completa (`-xerror`), recuento de fotogramas, `blackdetect`, `silencedetect`, huella SHA-256 registrada al terminar el render, composición duplicada. Argumentos por `execFile` (sin shell): un nombre de archivo malicioso no ejecuta nada.
- **Bloqueo «solo local»** (`lib/queue/local-guard.ts`): el runner rechaza (no ignora) variables de entorno de Supabase/Vercel/Google/YouTube/CRON/DATABASE_URL/PG*/claves de API, hosts remotos y `dry_run != true`. Solo se miran nombres de variables; los valores nunca se imprimen.

## 2. Resultados por escenario (PostgreSQL local real + ffmpeg real)

| Escenario | Resultado | Evidencia |
|---|---|---|
| Tres trabajos concurrentes | OK | 3 ejecutores + 1 sobrante: 3 completados, 1 idle; cada paso ejecutado 3 veces en total |
| Misma clave de idempotencia (×2 y ×10 simultáneas) | OK | 1 solo trabajo; el segundo devuelve el existente |
| Misma clave con payload distinto | OK | no crea nada, `payloadMismatch=true`; otro propietario no choca |
| Proyecto de otro propietario | OK | rechazado (`insufficient_privilege`) |
| Interrupción REAL del proceso (SIGKILL) | OK | worker hijo matado en el paso `b`; el lease sigue vigente (nadie lo roba); al caducar otro proceso lo retoma: `a` NO se repite (attempts 1), `b` intentos 2 |
| Lease caducado + ejecutor antiguo intenta terminar | OK | `lease_lost`; resultado final es el del nuevo ejecutor |
| Timeout en paso seguro | OK | vuelve a `pending` con espera; reanuda sin repetir lo hecho |
| Cancelación a mitad | OK | cooperativa: el paso actual termina, los siguientes quedan `pending`; pendiente = inmediata; otro propietario no puede cancelar; estado terminal inmutable |
| Presupuesto insuficiente | OK | 4 trabajos × 5 créditos, límite 10: solo 2 gastan (10 ≤ 10), 2 `budget_exhausted`; sin límite (0) nada llega al proveedor |
| Resultado económico incierto | OK | 500 en paso con cargo → `uncertain`, ocupa presupuesto; un fallo posterior (403) NO la libera; solo `resolveUncertain` (persona) |
| Aprobación ausente / revocada / caducada / otro payload / tope menor | OK | bloquea; el motivo coincide con `check_approval` de SQL |
| Publicación sin permiso | OK | se detiene en `publish`; proveedor 0 llamadas; con permiso, exactamente 1 |
| MP4 corrupto | OK (tras corrección, ver §4) | `fail: container_corrupt / integrity_hash_mismatch`; no llega a «Preparado» |
| MP4 sin audio con narración prevista / silencio | OK | `fail: audio_missing / audio_silent` |
| Material ausente / render incompleto | OK | `fail: clips_without_visual / render_marked_incomplete` |
| Negro sin motivo | OK | `review` (espera a una persona, nunca fallo automático) |
| Escena oscura intencionada | OK | `pass` |
| Composición duplicada | OK | `warn: possible_duplicate`; el trabajo continúa |
| Recuperación en el runner (`--recover`) | OK | A=`lease_lost`, B=`completed`, intentos=2, A ejecutó cada paso 1 vez |
| Invariantes de la simulación | OK | `externalCalls=0, budgetEntries=0, publishedOrSpent=0, duplicateJobRows=0`; coste estimado 5 créditos por trabajo simulado, reservado 0, confirmado 0 |
| Rechazo de configuración no local | OK | con `SUPABASE_*`/`VERCEL_*`/`ANTHROPIC_BASE_URL`, `--live`, host remoto: salida 2 y mensaje con nombres (sin valores) |

Comandos: `npm run queue:simulate -- --concurrent --recover` · `-- --fail` · `-- --help` (usar `env -i PATH=$PATH HOME=$HOME …` si el entorno tiene variables de servicios externas; el bloqueo es estricto a propósito).

## 3. Validación
- `tsc --noEmit`: limpio.
- Suite completa: **127 archivos OK / 4 omitidos; 1335 tests OK (13 omitidos)** (antes 1303; +32).
- SQL en PostgreSQL desechable: `ALL JOB-QUEUE SQL CHECKS PASSED (24 grupos)` (nuevo grupo: TODAS las funciones de `public`, no solo las nombradas, ejecutables únicamente por `service_role`).
- Pruebas multimedia con `ffprobe`/`ffmpeg` reales sobre MP4 generados localmente (sin material descargado ni archivos del usuario).

## 4. Problemas encontrados y corregidos
1. **QC dejó pasar un MP4 corrupto (alta).** Con ciertos bytes alterados (p. ej. semilla 3) ffmpeg decodifica sin error, aunque el archivo esté dañado. Prueba: 17 de 18 combinaciones se detectaban solo por decodificación; 1 no. Corrección: huella SHA-256 registrada al terminar el render (cualquier alteración posterior es `FAIL integrity_hash_mismatch`) y recuento de fotogramas decodificados vs. declarados. **Límite honesto:** un archivo que ya sale dañado del render, sin huella previa y que el decodificador disimula, no se detecta; por eso el paso de render debe registrar siempre su huella.
2. **Un worker reclamaba tipos de trabajo que no sabe ejecutar y los marcaba como fallidos (media).** `claim_next_job` y el ejecutor ahora filtran por `kinds`.
3. **Comportamiento distinto entre memoria y SQL en aprobaciones sin tope (media).** `{}` en `max_amount` se leía como «tope 0». Ahora `{}` = sin tope propio (manda el límite diario).
4. **Código de error 4xx perdido (baja).** Un QC fallido se registraba como `client_error`; ahora conserva `qc_failed`.
5. **Advertencia de `pg` por usar `set role` en el evento de conexión (baja).** El rol se fija en el arranque de la conexión (`-c role=service_role`).

## 5. Limitaciones pendientes
- Roles y `auth.uid()` siguen simulados con stubs: falta validar PostgREST y los grants por defecto reales de Supabase (requiere rama de BD de Supabase → 4B.3, necesita autorización).
- `resolveUncertain` con importes reales de varias unidades a la vez no está soportado (se resuelven por separado).
- El render y el guion son simulados; la integración con el render real de Cerebro Studio y con `publication_jobs` no se ha cableado (a propósito).
- `pg` se añadió como devDependency (solo desarrollo/tests); no entra en rutas de la app.
- Sin cron, sin worker desplegado, sin endpoints.

## 6. Propuesta Fase 4B.3 (requiere autorización separada)
1. Rama de BD de Supabase (no la base actual) para aplicar la migración y repetir allí la batería con roles reales y PostgREST.
2. Endpoints de cola en Preview (`POST /api/queue`, cancelar, aprobar) con sesión + propiedad, `dry_run` forzado, sin worker.
3. Panel mínimo de cola (estado, pasos, cancelar, aprobar/revisar QC).
4. Worker manual protegido por `CRON_SECRET`, aún sin cron.
