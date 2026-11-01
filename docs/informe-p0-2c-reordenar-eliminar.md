# P0.2C — Reordenar y eliminar escenas (0 €, local, sin push)

Pruebas **simuladas** (base en memoria que respeta UNIQUE(storyboard_id, position) con fallos inyectados); no se probó con Supabase ni navegador reales.

## Implementado
- `lib/scene-order.ts`: reordenar (↑/↓ con botones accesibles `aria-label`) mediante 3 actualizaciones con posición temporal (nunca viola la unicidad); compactar tras eliminar; `applyPositionSteps` deshace en orden inverso si un paso falla.
- `/create`: subir/bajar, eliminar con confirmación en línea (no `window.confirm`), aviso de montajes del editor que usan la escena (consulta `render_jobs.composition`), no borra archivos de la Biblioteca, doble clic protegido (`submitting`), borrado acotado por `storyboard_id` + RLS, «la escena ya no existía» si otro la borró.
- Se conservan textos, duraciones, prompts y metadatos (solo cambia `position`).
- Editor manual: «Guardar la mía encima» ahora **archiva primero la versión remota** como punto de recuperación; si no puede leerla, no sobrescribe.
- Propuesta SQL (NO aplicada, SIN probar): `supabase/pending/20261102130000_scenes_concurrency_and_reorder.sql` (+ rollback): `scenes.updated_at` + trigger y `reorder_scenes(storyboard, ids[])` atómica, `security invoker`.

## Limitaciones (sin maquillar)
- **No es atómico**: dos pestañas reordenando a la vez pueden intercalar pasos; el rollback cubre fallos propios, no carreras. Hasta aplicar la RPC no se promete protección completa.
- **Edición concurrente del contenido de una escena sigue sin token** (falta `scenes.updated_at`): la última escritura gana.
- Si falla el rollback se avisa de que el orden pudo quedar a medias y se recarga el estado real.
- La eliminación no tiene «deshacer» (solo confirmación previa).

## Validación
tsc limpio · suite y build en el informe del chat · coste 0 €.
