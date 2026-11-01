# Fase 4B.0 — Preparación técnica sin activación

Estado: código aislado + SQL pendiente. **Nada desplegado, ninguna migración aplicada, cron sin tocar, ninguna automatización activada.** Coste: 0 €. Rama `fase1-seguridad` (solo commit local).

## 1. Arquitectura técnica

```
 (4B.1+) worker/endpoint ──► runOnce(deps)               lib/queue/executor.ts
                              │ claim atómico + lease      QueueStore  (memory-store hoy · Supabase en 4B.1)
                              │ por cada paso:
                              │   cancelación → simulación → aprobación sellada → reserva de presupuesto
                              │   → run(ctx) con timeout y stepKey idempotente → conciliar / liberar
                              ▼
   policy.ts (429/403/5xx)   budget/ledger.ts (eur·usd·credits·quota)   qc/* (validadores puros)
```

- **Cola `job_queue`** (`supabase/pending/20261101120000_job_queue.sql`): estados `pending → running → completed / failed / cancelled / awaiting_approval`; `UNIQUE (owner_id, kind, idempotency_key)`; `payload_hash` para sellar aprobaciones; `lease_expires_at` + `claim_token` (fencing); `steps jsonb` con estado por paso; `dry_run` por defecto `true`; función `claim_next_job` con `FOR UPDATE SKIP LOCKED` que también recupera leases caducados.
- **Aprobaciones `job_approvals`**: ligadas a (trabajo, paso, acción: spend / render_batch / publish / retry_uncertain), al `payload_hash` y con caducidad; se invalidan si cambia el payload, se revocan o caducan. `retry_uncertain` es de un solo uso.
- **Presupuesto** (`budget_limits`, `budget_entries`, `reserve_budget`): límite diario por propietario + proveedor + (proyecto) + unidad. Sin límite = 0. Precio desconocido = bloqueo. Reserva atómica con advisory lock; reintento con misma clave no duplica; todo-o-nada entre unidades. La cuota gratuita (`quota`) es un contador aparte del dinero.
- **RLS**: el usuario solo puede LEER lo suyo. Crear, cancelar, aprobar, completar y presupuestar pasan por rutas de servidor / `service_role`. `claim_next_job` y `reserve_budget` solo ejecutables por `service_role`.
- **Ejecutor** (`lib/queue/executor.ts`): un paso `irreversible` (puede cobrar o publicar) debe exigir aprobación; un paso con coste debe ser irreversible; si no, el trabajo falla como `misconfigured_step` antes de ejecutar nada. En modo simulación esos pasos se saltan.
- **Política de errores** (`lib/queue/policy.ts`):

| Caso | Paso seguro | Paso irreversible |
|---|---|---|
| 401 / 403 | falla, sin reintento | falla, reserva liberada |
| 429 | reintenta solo si `retryOn429`, nunca antes de `Retry-After` | falla, sin reintento, reserva liberada |
| 5xx / timeout / desconocido | reintento con backoff (máx. intentos) | `awaiting_approval: uncertain_outcome`, reserva CONSERVADA (pudo cobrarse) |
| otro 4xx | falla | falla |

- **QC** (`lib/qc/validators.ts`, `fingerprint.ts`): funciones puras sobre metadatos (ffprobe/ffmpeg se conectan en 4B.2). Niveles `fail / warn / review`; el negro largo sin motivo es **revisión humana**, nunca fallo automático; escena marcada como oscura a propósito no cuenta; negro por falta de material sí es fallo. Huella de composición (sha256 de lo que cambia el resultado) para detectar renders duplicados.

## 2. Resultados de verificación

- `tsc --noEmit`: limpio.
- Suite completa: 122 archivos OK / 4 omitidos; **1302 tests OK** (13 omitidos); +42 nuevos (28 simulación, 6 presupuesto, 8 QC). Antes: 1260.
- SQL en PostgreSQL local desechable (`npm`-independiente: `bash scripts/test-job-queue-sql.sh`): migración idempotente (2 aplicaciones), unicidad de idempotencia por propietario, constraints, RLS (usuario no puede completar ni reclamar), **12 trabajos × 8 sesiones concurrentes → cada uno reclamado exactamente una vez**, lease caducado recuperado una sola vez, **8 sesiones compitiendo por un límite de 10 con reservas de 3 → exactamente 3**, reintento de reserva sin duplicar, aislamiento entre propietarios, rollback limpio. `ALL JOB-QUEUE SQL CHECKS PASSED`.
- Simulaciones (almacén y proveedor simulados): 3 trabajos concurrentes; misma clave dos veces; timeout (seguro e irreversible); reinicio del ejecutor (seguro e irreversible) con descarte del ejecutor antiguo; presupuesto agotado / precio desconocido; 401/403/429/500; cancelación pendiente y cooperativa; fallo de QC; aprobación ausente / invalidada / revocada / caducada / insuficiente; publicación sin permiso; modo simulación. En todos: **0 cargos duplicados, 0 publicaciones sin permiso, 0 trabajos repetidos**.

## 3. Matriz de riesgos

| Riesgo | Prob. | Impacto | Control |
|---|---|---|---|
| Doble ejecución de un trabajo | Media | Alto | claim atómico + lease + fencing por token; probado con 8 sesiones |
| Doble cargo por reintento | Media | Alto | pasos con cargo nunca se reintentan solos; misma `stepKey` al proveedor; reserva idempotente |
| Gasto no autorizado | Baja | Alto | límite 0 por defecto, precio desconocido bloquea, aprobación sellada al payload |
| Publicación accidental | Baja | Muy alto | paso `publish` exige aprobación; `dry_run` por defecto; QC `fail` detiene la cadena |
| Trabajo huérfano tras caída | Media | Medio | lease caducado → reclamo; paso irreversible a medias → revisión humana |
| Bucle de reintentos / tormenta 429 | Media | Medio | máx. intentos, backoff acotado, `Retry-After` respetado, 429 de pago no reintenta |
| Migración afecta datos existentes | Baja | Alto | solo tablas/funciones nuevas; no toca ninguna tabla existente; rollback probado |
| Falso positivo de QC en vídeo artístico | Media | Bajo | negro largo = revisión humana, no fallo |
| Fuga entre usuarios | Baja | Alto | RLS solo lectura propia; escrituras con service_role y validación de propiedad |
| Límite 300 s de Vercel | Alta | Medio | pasos cortos reanudables; un trabajo por invocación (4B.1+) |

## 4. Plan de despliegue progresivo (cada etapa pide autorización)

- **4B.1** — Aplicar la migración en un entorno de prueba (rama de Supabase o proyecto desechable) y luego, con autorización, en el proyecto compartido. Implementar `QueueStore` Supabase + endpoint `POST /api/queue` (encolar con sesión) y `POST /api/queue/[id]/cancel`. Sin worker, sin cron. Solo Preview.
- **4B.2** — Worker manual (`POST /api/queue/run`, protegido por `CRON_SECRET`, `dry_run` forzado). Conectar QC a ffprobe/ffmpeg real sobre renders de prueba. Solo Preview.
- **4B.3** — UI de cola (ver, cancelar, aprobar) y aprobaciones selladas reutilizando el sistema de YouTube. Presupuestos editables por Jesús.
- **4B.4** — Primer cron de cola en Preview con `dry_run`; después, con autorización explícita, un único tipo de trabajo gratuito en Production. Lotes máx. 3, siempre en cola.
- Nunca: activar gasto o publicación automática sin aprobación específica por tipo de trabajo.

## 5. Procedimiento de rollback

1. Pausar el worker/cron de cola (si existe) — no afecta al cron actual de automatizaciones.
2. Cancelar trabajos pendientes (`status='cancelled'`), esperar a que expiren los leases.
3. Exportar si se quiere conservar historial: `select * from job_queue; select * from budget_entries;`.
4. Ejecutar `supabase/pending/20261101120000_job_queue.rollback.sql` (solo borra las 4 tablas y 2 funciones nuevas; **es un borrado de datos de tablas nuevas → requiere autorización de Jesús**).
5. Revertir el commit de código; las rutas y módulos nuevos no son usados por el código actual, así que el resto de la app no cambia.

## 6. Acciones que requieren aprobación de Jesús (punto de parada: **Fase 4B.1**)

1. Autorizar aplicar la migración aditiva `job_queue` (primero en un entorno de prueba; luego en el proyecto compartido `psbvqdaksrfrkxbewrll`).
2. Autorizar desplegar a Preview el código de 4B.1 (endpoints de cola, sin worker ni cron).
3. Definir límites diarios (por defecto 0 € / 0 créditos; cuota YouTube gratuita separada).
4. Decidir si se mantiene la automatización diaria `trend_watch` (no se ha tocado).
5. OAuth de Google: pasar la app a Producción y reconectar YouTube (no se ha tocado).
6. Cualquier cron nuevo, worker automático, gasto en modelos de pago o publicación automática.
