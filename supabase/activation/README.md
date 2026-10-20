# Activación de migraciones · preparada el 20-10-2026 · APLICADA el 21-10-2026

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

## Intento autorizado del 21-10-2026

- Antes de empezar se comprobó que:
  - los tres SQL coinciden con las versiones ensayadas (`scripts/test-activation.sh`: 13 de 13);
  - el estado real coincide con la instantánea: 56 permisos, las políticas `*_own`, 0 ejecuciones en curso;
  - no había objetos `research_*` previos;
  - ninguna fila se vería afectada.
- **Paso 1 (`research_cache`):** la herramienta `apply_migration` agotó su tiempo de espera (180 s) dos veces. Después de cada intento se comprobó que **no se aplicó nada**: ni tabla, ni funciones, ni registro en `schema_migrations`.
- Como se pidió, **no se ejecutaron los pasos 2 y 3**.

Para aplicarla hace falta otra vía: el SQL Editor de Supabase, ejecutando cada archivo en orden y después `post-check.sql`, o un conector de Supabase que no se quede bloqueado.

## Aplicación del 21-10-2026 (SQL Editor de Supabase, proyecto Cerebro Studio `psbvqdaksrfrkxbewrll`)

- **Antes de ejecutar:**
  - Se volvió a leer el estado: idéntico a `pre-snapshot-2026-10-20.json`. Hay 56 permisos, las políticas `*_own`, 0 ejecuciones en curso, 2 conexiones y 10 proyectos.
  - Se comprobó que el contenido cargado en el editor tenía el **mismo SHA-256** que cada archivo ensayado:
    - `ee06666b…` (research_cache)
    - `3bc8f395…` (campaigns)
    - `51237be4…` (seguridad)
- **Orden:** cada migración se ejecutó por separado y se comprobó antes de pasar a la siguiente. Las tres respondieron «Success» y su comprobación individual fue correcta.
- **`post-check.sql`:** 13 de 13 en `true`.
- **Historial:** registradas en `supabase_migrations.schema_migrations` con las versiones del repositorio `20261013120000`, `20261015120000` y `20261018120000`, para que no se vuelvan a ejecutar.
- **Datos:** no se modificó ni se borró ninguna fila. Después de aplicar siguen igual las conexiones, los proyectos, la ejecución de automatización y los trabajos.

### Permisos comprobados con el rol real del usuario (`authenticated`)

Las pruebas se hicieron dentro de un bloque que siempre se revierte; después se confirmó que no quedó ninguna fila de prueba.

| Prueba | Resultado |
|---|---|
| Insertar una aprobación | Denegado |
| Crear un borrador de publicación | Permitido |
| Autoaprobarlo o crearlo ya aprobado | Denegado |
| Cancelarlo | Permitido |
| Marcarlo como publicado | Denegado |
| Leer las columnas seguras de las conexiones | Permitido |
| Leer `token_ciphertext` | Denegado |
| Modificar o borrar conexiones | Denegado |
| Escribir en el registro de gasto | Denegado; leerlo, permitido |
| Crear y leer una campaña propia | Permitido |
| Crear una campaña a nombre de otro usuario | Denegado |
| `research_reserve` | Correcta |
| `research_lock` | El primer intento obtiene el bloqueo y el segundo no |

## Verificación en Preview (21-10-2026, sesión real del propietario, sin publicar ni gastar)

| Módulo | Qué se comprobó |
|---|---|
| Investigación | Una búsqueda real del motor 7 («historias reales increíbles», Mundial), con el coste previsto de 204 unidades y 2 búsquedas: 50 vídeos reales con sus métricas, un aviso de muestra insuficiente y el historial guardado en la cuenta. Los registros de la API muestran llamadas a `research_lock` y `research_reserve`, es decir, se usaron las funciones atómicas. Abrir la página cargó además las tendencias de España (2 unidades): **206 unidades en total**. |
| Campañas | Crear una campaña la guarda en la tabla `campaigns`, y borrarla la elimina de la cuenta. |
| Seguridad | La página de Conectores lee la conexión de YouTube usando solo columnas seguras. Se preparó un borrador y se aprobó: la aprobación la escribe el servidor y queda sellada. El trabajo se canceló **sin publicar**; quedan como registro de prueba un trabajo cancelado y una aprobación. |
| Biblioteca | Muestra los 6 archivos del propietario y no muestra los de otros usuarios. |
| Editor | Se abren los montajes guardados. El navegador del ordenador admite H.264 y AAC nativos para la conversión sin GPL. **Error corregido:** al abrir un montaje sin voces se mostraba un aviso falso de «voces movidas» y el estado «sin guardar». |
| Automatizaciones | Comprobados la validación (falta de palabra clave), la creación en modo manual, la pausa y el borrado. No se ejecutó, para no gastar cuota. |
