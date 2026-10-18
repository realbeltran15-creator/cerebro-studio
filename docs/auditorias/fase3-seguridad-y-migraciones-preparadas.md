# Auditoría de seguridad y migraciones preparadas · rama `fase1-seguridad` · 18-10-2026

Las migraciones están **preparadas y probadas solo en una base de datos local desechable**. No se han aplicado ni en la base compartida de Supabase ni en Producción. Tampoco se ha usado cuota, gastado créditos ni publicado nada.

## 1. Endurecimiento RLS de publicaciones (preparado)

- **Migración:** `supabase/migrations/20261018120000_publication_rls_hardening.sql`
- **Reversión:** `supabase/rollback/20261018120000_publication_rls_hardening.down.sql`
- **Prueba:** `bash scripts/test-publication-rls.sh` (PostgreSQL local con los roles de Supabase simulados). Comprueba la idempotencia y la reversión.

Qué permite el navegador después de aplicarla:

| Acción desde el navegador (sesión del dueño) | Antes | Después |
|---|---|---|
| Insertar una aprobación «approved» falsa | Permitido | Rechazado |
| Crear un trabajo ya aprobado | Permitido | Rechazado |
| Pasar un borrador a «approved» | Permitido | Rechazado |
| Cambiar el payload manteniendo «approved» | Permitido | Rechazado |
| Escribir o borrar un trabajo publicado | Permitido | 0 filas |
| Crear y editar borradores, cancelar un aprobado | Permitido | Permitido |
| Tocar trabajos de otro usuario | Rechazado | Rechazado |

**Cambio de código que lo hace posible.** Ya está en la rama, y es compatible con el estado actual:

- `lib/supabase/admin.ts`: `publicationWriter()` usa la *service role* si `SUPABASE_SERVICE_ROLE_KEY` está configurada y, si no, la sesión del usuario (el comportamiento actual).
- Las rutas `approve` y `publish` de YouTube e Instagram/TikTok escriben con ese cliente las aprobaciones y los cambios de estado y resultado. Las lecturas siguen usando la sesión del usuario.
- Todas las escrituras van filtradas por el `owner_id` del usuario autenticado.
- Prueba: `tests/publication-writer.test.ts`.

**Orden para aplicarla, con autorización:**

1. Desplegar esta rama con `SUPABASE_SERVICE_ROLE_KEY` en ese entorno. Ya existe para el cron; hay que comprobar que también esté en Preview.
2. Comprobar en Preview que aprobar sigue funcionando.
3. Aplicar la migración.
4. Repetir la comprobación. Si algo falla, aplicar la reversión.

## 2. `research_cache` (preparada desde antes)

`20261013120000_research_cache.sql`, con su reversión, ya estaba en el repositorio. `scripts/test-migrations.sh` vuelve a pasar en local, incluida la prueba de concurrencia. **Sin aplicar.**

## 3. Hallazgos de la auditoría (sin corregir; requieren decisión)

| # | Gravedad | Hallazgo | Propuesta |
|---|---|---|---|
| S-1 | Alta | El tope de gasto se calcula con filas de `assets` y `connector_configs`, que el navegador puede borrar (política `for all`). Borrar recursos generados «reinicia» el gasto contado. | Un registro de gasto propio solo de inserción, escrito por el servidor con la *service role*, con RLS de solo lectura para el dueño. Migración nueva, pendiente de autorización. |
| S-2 | Media | `channel_connections` (tokens OAuth cifrados) es `for all`: el navegador puede leer los tokens cifrados y sobrescribir o borrar la conexión. El cifrado evita su uso directo, pero no la manipulación. | Lectura de columnas no sensibles mediante una vista. Escrituras solo desde el servidor, igual que en el punto 1. |
| S-3 | Media | El resto de tablas (`assets`, `render_jobs`, `automations`, etc.) usan `for all` por dueño. Es correcto para datos propios, pero las automatizaciones (horarios y acciones) se pueden reescribir desde el navegador. | Revisar después del punto 1. Las automatizaciones nunca publican, así que el riesgo es bajo. |
| S-4 | Info | `approvals` en las migraciones del repositorio tiene `action_key`, pero el código escribe `entity_type`, `entity_id` y `risk_summary`. La base real debe de tener columnas añadidas fuera del repositorio. | Generar los tipos o el esquema desde Supabase (solo lectura) y reflejarlo en una migración documental. |
| S-5 | Info | Todas las rutas `/api/*` comprueban la sesión (o el secreto del cron). No se encontró ninguna ruta abierta. | — |

## 4. Comprobaciones de esta entrega

| Comprobación | Resultado |
|---|---|
| `tsc` | Sin errores |
| `vitest` | 844 correctas, 13 omitidas |
| ESLint | 0 errores |
| Prueba RLS de publicaciones (17 casos) | Correcta |
| Prueba de migraciones existentes | Correcta |
