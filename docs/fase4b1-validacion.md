# Fase 4B.1 — Validación de la migración en entorno aislado

Entorno: PostgreSQL 16 local desechable (solo socket unix en /tmp, `listen_addresses=''`, sin red, sin credenciales, borrado al terminar). No se tocó Supabase, Production, Vercel, cron ni credenciales. Coste: 0 €. Sin push ni despliegue.
Reproducir: `bash scripts/test-job-queue-sql.sh` → `ALL JOB-QUEUE SQL CHECKS PASSED (23 grupos)`.

## Resultados (OK / FALLO / BLOQUEADO)

| Área | Resultado | Evidencia |
|---|---|---|
| Aislamiento de la prueba | OK | La migración no contiene URLs ni credenciales; BD solo por socket local |
| Migración idempotente | OK | Aplicada 2 veces sin error ni duplicados |
| RLS activa en las 4 tablas | OK | `relrowsecurity` = true |
| Aislamiento entre propietarios | OK | A ve 1 trabajo (el suyo), B 1 (el suyo); A ve 0 de B. Probado con roles `authenticated` distintos |
| Escritura por usuarios | OK | `authenticated` NO puede insert/update/delete en ninguna de las 4 tablas (incluidos límites de presupuesto y aprobaciones) |
| `anon` | OK | Sin lectura en ninguna tabla |
| EXECUTE de funciones | OK | Las 10 funciones privilegiadas solo ejecutables por `service_role`; `authenticated`, `anon` y `public` denegados |
| SECURITY DEFINER | OK | Todas con `search_path = public, pg_temp` fijo |
| Reclamo atómico | OK | 12 trabajos × 8 sesiones concurrentes: cada uno reclamado exactamente una vez |
| Lease / token caducado | OK | heartbeat/finish rechazan token ajeno y lease caducado; tras reclamar, el ejecutor antiguo no puede escribir ni terminar; 8 `finish` simultáneos con el mismo token → exactamente 1 gana |
| Estados terminales | OK | Un trabajo completado/fallido/cancelado no puede volver a pending/running |
| Aprobaciones | OK | `check_approval` rechaza: ausente, otra acción, otro paso, payload cambiado, revocada, caducada y de otro propietario |
| Presupuesto | OK | Sin límite = 0; precio desconocido y negativo bloqueados; 8 sesiones sobre límite 10 con reservas de 3 → exactamente 3 (9 ≤ 10); reintento con misma clave no duplica; B no hereda límites de A |
| Resultado incierto | OK | `release_budget` no libera reservas `uncertain`; siguen ocupando límite; solo `resolve_uncertain_budget` (cobrado / no cobrado) las resuelve; `settle` concilia lo incierto tras un reintento idempotente |
| Rollback | OK | Tras aplicar+rollback el `pg_dump --schema-only` es idéntico al previo; la fila preexistente intacta; el rollback es idempotente |
| TypeScript | OK | `tsc --noEmit` limpio |
| Suite completa | OK | 1303 tests OK (13 omitidos) |
| Integración con Supabase real | BLOQUEADO a propósito | No autorizado en esta fase |

## Vulnerabilidades y defectos encontrados por esta validación (todos corregidos)

1. **Convención de claves de presupuesto incoherente (alta).** `reserve_budget` guardaba la clave tal cual y `settle/release` buscaban `<clave>:<unidad>`; en la implementación Supabase la conciliación y liberación habrían sido no-ops silenciosos (reservas eternas o doble cargo lógico). Ahora `reserve_budget` guarda `<clave>:<unidad>`, igual que el ledger TS.
2. **`finish_job` aceptaba un lease caducado (media).** Un ejecutor lento podía terminar un trabajo que ya podía haber reclamado otro. Ahora exige lease vigente.
3. **Reservas inciertas liberables (alta, económica).** Un fallo posterior habría liberado una reserva de un paso que quizá cobró. Nuevo estado `uncertain`: nunca se libera sola, sigue contando contra el límite, la resuelve una persona. Reflejado en el ejecutor TS (`markUncertain`) y en SQL.
4. **Estados terminales mutables (media).** Trigger `job_queue_terminal_guard`.
5. **Aprobaciones solo en TypeScript (media).** Nueva función SQL `check_approval` como fuente única de verdad.
6. **Comodines LIKE (baja).** `release_budget('%')` habría liberado reservas ajenas con `LIKE`; ahora `starts_with` + prueba específica.
7. **`search_path` sin `pg_temp` (baja).** Fijado en todas las funciones SECURITY DEFINER.

## Requisitos para revertir en otros entornos
1. Pausar el worker; cancelar pendientes y esperar a que caduquen los leases.
2. Exportar `job_queue` y `budget_entries` si se quiere conservar historial.
3. Ejecutar `supabase/pending/20261101120000_job_queue.rollback.sql` (borra solo 4 tablas, 1 trigger y 11 funciones nuevas; **requiere autorización de Jesús** por borrar datos de tablas nuevas).
4. Revertir el commit de código.

## Secuencia exacta para un entorno de prueba de Supabase (cuando se autorice)
1. Crear rama de BD o proyecto desechable (nunca `psbvqdaksrfrkxbewrll`).
2. Aplicar `20261101120000_job_queue.sql` dos veces (idempotencia).
3. Ejecutar las comprobaciones de `scripts/test-job-queue-sql.sh` adaptadas a los roles reales (`anon`, `authenticated`, `service_role`).
4. Comparar el esquema antes/después, aplicar el rollback y comparar de nuevo.
5. Eliminar la rama/proyecto de pruebas.

## Límites de esta validación
Roles y `auth.uid()` son simulados con stubs; no cubre PostgREST ni la configuración real de Supabase (grants por defecto del esquema `public`, `pg_graphql`). Eso queda para una rama de BD de Supabase si Jesús la autoriza. Siguen sin implementarse ni conectarse: `QueueStore` Supabase, endpoints, worker y cron (4B.2+).
