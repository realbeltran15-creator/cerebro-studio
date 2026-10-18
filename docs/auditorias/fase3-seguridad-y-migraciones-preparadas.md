# Seguridad: estado servidor-propietario y migraciones preparadas · rama `fase1-seguridad` · 18-10-2026

**Las migraciones están preparadas y probadas solo en PostgreSQL local desechable. NO están aplicadas.** No se ha usado cuota, gastado créditos ni publicado nada.

## Qué corrige (código ya desplegable; compatible con la base actual)

| # | Problema | Corrección en código | Lo cierra en BD |
|---|---|---|---|
| S-1 | El navegador podía falsificar aprobaciones, autoaprobar o cambiar un trabajo aprobado | Sello HMAC verificado en el servidor (fase 1). Las aprobaciones y los estados se escriben con `lib/supabase/admin.ts` (*service role*) | Sección 1 |
| S-2 | El gasto contado se «reiniciaba» al borrar archivos generados | Registro de gasto del servidor `generation_spend` (`lib/providers/spend-ledger.ts`). Cada generación de pago se anota **antes** de enviarse; si no se puede anotar, no se envía. El tope usa el mayor entre ese registro y lo deducido de los archivos | Sección 3 |
| S-3 | El navegador podía crear, modificar o borrar conexiones OAuth y leer los tokens cifrados | Todas las escrituras y lecturas de tokens de `channel_connections` se hacen en el servidor con la *service role* (callbacks, desconexión, refresco, publicación) | Sección 2 |
| S-4 | Dos ejecuciones simultáneas de una automatización (cron y clic) | Guarda en código (fase 2) y gestión del error de índice único | Sección 4 |

Sin `SUPABASE_SERVICE_ROLE_KEY`, o antes de la migración, el código se comporta exactamente como hoy (usa la sesión del usuario).

## Migración única: `supabase/migrations/20261018120000_server_owned_security.sql`

**Reversión:** `supabase/rollback/20261018120000_server_owned_security.down.sql`.

**Prueba:** `bash scripts/test-server-owned-security.sh`. Usa el esquema y los **nombres reales de las políticas** de producción (`*_own`), leídos en modo solo lectura el 18-10. Son 29 comprobaciones, incluidas la idempotencia y la reversión.

1. **`approvals` y `publication_jobs`:** el navegador solo puede leer, crear y editar borradores, y cancelar.
2. **`channel_connections`:** el navegador solo puede leer las columnas no secretas. No puede escribir ni leer `token_ciphertext` ni `token_metadata`.
3. **`generation_spend`:** tabla nueva de solo inserción desde el servidor; el dueño solo puede leerla.
4. **`automation_runs`:** índice único que permite una única ejecución en curso («running») por automatización. Hoy no hay ninguna en curso, así que no hay datos en conflicto.

**Datos actuales que afecta:** 2 conexiones OAuth (no cambian), 0 trabajos de publicación y 0 ejecuciones en curso. No se modifica ni se borra ningún dato existente.

**Orden:**

1. Comprobar que `SUPABASE_SERVICE_ROLE_KEY` está en Preview.
2. Desplegar esta rama.
3. Aplicar la migración.
4. En Preview: conectar y desconectar YouTube, aprobar un borrador y lanzar una automatización.
5. Si algo falla, aplicar la reversión.

`research_cache` (`20261013120000`) y `campaigns` (`20261015120000`) siguen preparadas y sin aplicar. Su prueba (`scripts/test-migrations.sh`) pasa.
