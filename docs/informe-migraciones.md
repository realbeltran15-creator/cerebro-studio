# Informe técnico: migraciones pendientes (`research_cache`, `campaigns`)

Fecha: 2026-10-15 · Estado: **ninguna aplicada**. La base (`psbvqdaksrfrkxbewrll`) es compartida por Preview y Producción.

## Recomendación
| Migración | ¿Aplicar? | Motivo |
|---|---|---|
| `20261013120000_research_cache.sql` | **Sí, cuando lo autorices** | Es aditiva y de bajo riesgo. Sin ella el contador de cuota del servidor está en memoria y se reinicia en cada arranque (la app lo avisa en pantalla). Con ella, la caché de análisis (7 días) y el presupuesto diario son persistentes y compartidos entre instancias. |
| `20261015120000_campaigns.sql` | **No todavía** | La app aún no lee ni escribe esa tabla (las campañas viven en el navegador). Aplicarla hoy no aporta nada. Se aplicaría cuando exista el código que la use. |

## Qué se ha comprobado
**Contra la base real (solo lectura, sin cambios):**
- Ninguna de las dos tablas existe. Migraciones aplicadas: 12 (la última, `20261010101951 shorts_factory`).
- `public.projects.id` y `owner_id` son `uuid` → la clave foránea de `campaigns.project_id` es compatible.
- Las tablas existentes usan una política `*_own` con `owner_id = (select auth.uid())`; las nuevas siguen el mismo patrón.
- PostgreSQL 17.6; `pgcrypto` instalado (`gen_random_uuid()` disponible; en PG ≥ 13 también es nativo).

**Contra una base aislada (PostgreSQL 16 local desechable, con stubs de Supabase: `auth.users`, `auth.uid()`, roles `anon`/`authenticated`, privilegios por defecto):** `scripts/test-migrations.sh` → **ALL MIGRATION CHECKS PASSED**:
- Se pueden aplicar dos veces seguidas (idempotentes).
- RLS: el dueño lee y escribe lo suyo; otro usuario no ve, no modifica ni borra; no se pueden crear filas a nombre de otro; `anon` no tiene acceso.
- `campaigns.project_id` no puede apuntar al proyecto de otra persona (la política lo comprueba; una clave foránea sola lo aceptaría).
- Restricciones: estado inválido, unidades negativas, clave de caché duplicada por usuario y `brief` > 200 KB se rechazan.
- Borrar un proyecto deja la campaña (`project_id` → null); borrar un usuario borra sus filas.
- Índices y políticas presentes; RLS activo en ambas.
- **Segundo límite diario**: columna `searches` y `research_reserve(..., p_searches, p_search_cap)` comprueban a la vez las unidades y las búsquedas; probado que un límite agota el día con el otro sobrado (y viceversa) y con 8 sesiones simultáneas.
- **Funciones de coordinación** (`research_quota_day_start`, `research_reserve`, `research_lock`): reserva bajo tope (acepta hasta el tope y rechaza el resto sin dejar fila), liquidación, exclusividad de la concesión, toma de una concesión caducada, aislamiento por usuario, día de cuota = medianoche del Pacífico, sin permiso para `anon`; y **8 sesiones simultáneas** compiten por presupuesto y concesión sin pasarse (`CONCURRENCY CHECK PASSED`).
- Reversión: los `*.down.sql` eliminan las tablas **y las tres funciones** y no tocan `projects`.
Limitación: no es un Supabase completo (no se probó PostgREST ni Realtime), y el motor local es 16, no 17.

## Seguridad
- RLS activado y `revoke all … from anon` en ambas tablas; políticas solo `to authenticated`.
- No se guardan tokens ni credenciales publicitarias en `campaigns.brief` (documentado en la migración).
- `research_cache` solo guarda análisis públicos de YouTube y líneas de uso (unidades); sin datos personales.
- El servidor accede con la sesión del usuario (RLS), no con la clave de servicio.

## Riesgo para Producción
- Cambios aditivos: tablas nuevas, sin alterar ninguna existente ni funciones/triggers compartidos.
- Bloqueos: `create table`/`create index` sobre tablas nuevas, sin impacto en otras.
- La app funciona sin la migración (`openStore` cae a memoria) y funciona con ella; no hay despliegue acoplado. Se puede aplicar antes o después del código.
- Efecto observable tras aplicar `research_cache`: el contador diario pasa de memoria a persistente (y el aviso «contador en memoria» desaparece). Las búsquedas libres y las listas de tendencias también cuentan en ese contador.
- Crecimiento: una fila por análisis (≈ 30–60 KB de JSON) y una línea pequeña por búsqueda/lista; limpieza oportunista de filas caducadas hace > 30 días.

## Reversión
`supabase/rollback/20261013120000_research_cache.sql` / `…campaigns.down.sql` (`drop table if exists`). La de `research_cache` solo pierde datos regenerables; la de `campaigns` es destructiva si ya se usó (exportar antes).

## Cómo aplicarla (cuando decidas)
1. Autorización explícita tuya.
2. Aplicar `20261013120000_research_cache.sql` con la herramienta de migraciones de Supabase (o `supabase db push`), no con SQL suelto.
3. Comprobar: `select count(*) from public.research_cache;` (0 filas), `select polname from pg_policy` y que `/api/research/usage` devuelva `persistent: true`.
4. Si algo falla: ejecutar el `down` correspondiente.


Detalle de persistencia (qué guarda, supervivencia a despliegues, duplicados, cuota, políticas y reversión): `docs/informe-persistencia-research-cache.md`.
