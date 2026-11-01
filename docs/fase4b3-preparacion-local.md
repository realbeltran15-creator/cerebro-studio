# Fase 4B.3 — Preparación LOCAL (nada conectado, nada desplegado)

Estado: código listo pero **desactivado**. Sin Supabase, sin Vercel, sin cron, sin credenciales. Coste 0 €.

## Qué se preparó
- `lib/queue/config.ts`: la cola solo se activa si `QUEUE_ENABLED=true`, `QUEUE_ENVIRONMENT=test`, `QUEUE_TEST_PROJECT_REF` válido y distinto del de Production, `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co` de ese ref, `VERCEL_ENV != production`, sin `QUEUE_KILL_SWITCH`, sin modo real. Cualquier duda = desactivada.
- `lib/queue/api.ts` + rutas `POST /api/queue`, `GET /api/queue/[id]`, `POST /api/queue/[id]/cancel`: 404 si está apagada; 401 sin sesión; CSRF (Origin = Host) en POST; límite de peticiones (429); validación de tipo (`video_production`), clave, UUID y tamaño; `dry_run` forzado (pedir `false` = 400); propiedad en servidor (ajeno = 404); respuesta sin token/ejecutor/hash.
- `app/queue/page.tsx`: panel de solo lectura (RLS del usuario); si la tabla no existe dice que no está activada.
- `tests/queue-api.test.ts`: 13 pruebas (config, 404/401/403/429, dry_run, doble envío, 409, aislamiento entre usuarios, no filtrado de campos).

## No hay worker
Las rutas solo encolan, consultan y cancelan. Nada ejecuta trabajos (4B.3C requiere autorización aparte).

## Lista de verificación previa a activar en una rama de pruebas (requiere autorización de Jesús)
1. Rama Supabase nueva y aislada (no la base actual); confirmar ref distinto de `psbvqdaksrfrkxbewrll`, y coste 0 € en la consola antes de crearla.
2. Aplicar `supabase/pending/20261101120000_job_queue.sql` SOLO en la rama; repetir la batería SQL con roles reales (PostgREST, grants por defecto de Supabase, `auth.uid()` real).
3. Confirmar que `service_role` es la única que ejecuta las funciones y que `anon`/`authenticated` no (consulta a `information_schema.routine_privileges`).
4. Variables SOLO en el entorno Preview: `QUEUE_ENABLED=true`, `QUEUE_ENVIRONMENT=test`, `QUEUE_TEST_PROJECT_REF`, y las claves de la rama. Nunca en Production.
5. Probar: 404 con la cola apagada, 401 sin sesión, 403 sin Origin, aislamiento entre dos usuarios, dry_run forzado.
6. Confirmar: sin cron nuevo, sin cambios en `trend_watch`/`shorts_factory`, sin publicaciones, sin gasto.

## Desactivación inmediata (kill switch)
1. Poner `QUEUE_KILL_SWITCH=true` (o quitar `QUEUE_ENABLED`) en el entorno Preview y redeploy: las rutas devuelven 404 de inmediato y el panel muestra «no activada».
2. Si hace falta, revocar el acceso: eliminar las variables de la rama de pruebas en Vercel.
3. Reversión de datos: `supabase/pending/20261101120000_job_queue.rollback.sql` (solo en la rama).
4. La base de Production no se ve afectada en ningún paso: nunca recibe la migración.

## resolveUncertain multiunidad
Sigue **no soportado** en el adaptador RPC (se resuelve por unidad). Es seguro porque con presupuesto 0 € no hay reservas reales; **debe resolverse antes de habilitar costes reales** (propuesta: función SQL `resolve_uncertain_budget_multi` atómica, con la misma convención de claves `<base>:<unit>`).
