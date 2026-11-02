# Migraciones presentes en Production y ausentes del repositorio (recuperadas)

Production (`supabase_migrations.schema_migrations`) guarda el **texto original** de cada migración aplicada. Se consultó **solo lectura** (un `select` sobre esa tabla; sin leer datos de usuario ni modificar nada) el 2026-11-02. Las tres migraciones que el repositorio no tenía son:

| Versión en Production | Nombre | Estado | Archivo |
|---|---|---|---|
| 20260916214243 | `security_and_performance_hardening` | **Historial original recuperado** (texto íntegro) | `20260916214243_security_and_performance_hardening.sql` |
| 20260928193119 | `shared_ai_memory_v1` | **Historial original recuperado** (texto íntegro) | `20260928193119_shared_ai_memory_v1.sql` |
| 20260928200258 | `ai_memory_v2_shared_handoff` | **Solo estructura documentada.** No se copia el texto porque contiene `INSERT`/`UPDATE` (datos de la memoria de IA, ajenos a Cerebro Studio); no toca `public` | ver abajo |

## Clasificación

- **Historial original recuperado**: los dos ficheros `.sql` de esta carpeta son copia literal de lo guardado en Production. No son migraciones del repositorio original (no existían en git): se guardan aquí como evidencia, **no** en `supabase/migrations/`, para no alterar el orden ni las marcas de tiempo del historial.
- **Equivalencia estructural reconstruida**: `supabase/schema/baseline_live.sql` ya reproduce el efecto de `security_and_performance_hardening` (los 12 índices, las políticas con `(select auth.uid())`, la revocación de `handle_new_user`) y `scripts/test-schema-drift.sh baseline` falla ante cualquier diferencia con Production. `scripts/test-recovered-on-baseline.sh` comprueba que aplicar el texto original encima del baseline **no cambia nada** de lo que aplica. Precisión: el baseline es el estado *final*; de las 13 políticas que `security_and_performance_hardening` modificó, **10 siguen vigentes** y **3 (`connections_own`, `publication_jobs_own`, `approvals_own`) fueron sustituidas después** por `server_owned_security` (migración del repositorio, 20261018120000), así que esas 3 sentencias no pueden reaplicarse sobre el estado final y el test lo declara explícitamente y que `shared_ai_memory_v1` solo crea el esquema `ai_memory`, sin tocar `public`.
- **Cambios pendientes de aplicar**: ninguno de estos tres. Los pendientes siguen siendo las 7 migraciones de `supabase/pending/`.
- **Fuera del alcance de la beta**: el esquema `ai_memory` (v1 y v2) es una memoria compartida de IA, no lo usa la aplicación y **no se crea** en un entorno nuevo de la beta.

## `ai_memory_v2_shared_handoff` — estructura (sin datos)

Esquema `ai_memory`: tabla `entries`; índices `activity_log_project_idx`, `entries_project_idx`; funciones `assert_no_secret`, `_check_actor`, `trg_projects_before`, `trg_projects_log`, `trg_block`, `trg_log_secret`, `trg_entries_guard`, `trg_entries_log` y las RPC `list_projects`, `get_handoff`, `create_project`, `update_project`, `add_entry`, `set_entry_status`; disparadores `projects_before`, `projects_log`, `log_no_modify`, `log_no_truncate`, `log_secret_guard`, `projects_no_truncate`, `entries_no_truncate`, `entries_guard`, `entries_log`. Si algún día hiciera falta, el texto completo se recupera con el mismo `select` desde Production por quien tenga autorización.

## Entorno nuevo

Un entorno nuevo reproduce el esquema necesario para la beta con `baseline_live.sql` + las 7 pendientes + el disparador `on_auth_user_created` (verificado desde cero sobre Auth/Storage/PostgreSQL oficiales con `scripts/official-stack.sh up`). Nota de plataforma: el esquema depende de los privilegios por defecto que Supabase crea en cada proyecto nuevo.
