# Activación de migraciones pendientes · preparada el 20-10-2026 · NO APLICADA

Requiere una autorización explícita del propietario: la base de datos es compartida entre Preview y Producción.

## Orden (cada paso es una transacción; si uno falla, no cambia nada)

1. `supabase/migrations/20261013120000_research_cache.sql`: crea una tabla nueva.
2. `supabase/migrations/20261015120000_campaigns.sql`: crea una tabla nueva y depende de `projects`, que ya existe en la base real.
3. `supabase/migrations/20261018120000_server_owned_security.sql`: cambia las políticas, los permisos y añade un índice.
4. `supabase/activation/post-check.sql`: solo lectura. Todas las columnas deben dar `true`.

Ensayo completo: `bash scripts/test-activation.sh`.
- Reproduce en un PostgreSQL local desechable el estado real leído el 20-10-2026: políticas `*_own` «for all» con rol `public`, permisos completos, 2 conexiones y 0 ejecuciones en curso.
- Aplica los tres pasos y la comprobación. Resultado: **APROBADO** (13 de 13).

## Estado real comprobado el 20-10-2026 (solo lectura)

- PostgreSQL 17.6.
- `pgcrypto` está instalado.
- `projects` existe.
- `research_cache`, `campaigns` y `generation_spend` no existen.
- Hay 2 conexiones OAuth, 0 trabajos de publicación y 0 ejecuciones en curso.
- Todas las lecturas que hace el navegador en `channel_connections` piden solo columnas no secretas, así que siguen funcionando tras la migración.

## Copia de seguridad

El plan es **Free**: Supabase no ofrece copias restaurables desde el panel. Por eso:

- **No se modifica ni se borra ninguna fila.** Las tablas nuevas empiezan vacías. La única sentencia `update` cierra las ejecuciones «running» antiguas, y hoy hay 0.
- El estado anterior del esquema afectado está guardado en `pre-snapshot-2026-10-20.json`: políticas y permisos, sin datos ni secretos.
- **Reversión:**
  - Seguridad: `supabase/rollback/20261018120000_server_owned_security.down.sql`, que devuelve exactamente ese estado.
  - Tablas nuevas: `20261013120000_research_cache.down.sql` y `20261015120000_campaigns.down.sql`, que eliminan las tablas.

## Después de aplicar (en Preview)

- Conectar y desconectar YouTube.
- Aprobar un borrador sin publicarlo.
- Lanzar una automatización.
- Crear una campaña de prueba y recargar la página para comprobar que se conserva. La caché de Investigación (`research_cache`) solo se prueba con una búsqueda real, que gasta cuota y necesita su propia autorización.

Si algo falla, aplicar la reversión de seguridad.
