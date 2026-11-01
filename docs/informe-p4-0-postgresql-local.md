# P4.0 — PostgreSQL local aislado (Bloques C/D)
Etiqueta obligatoria: **PostgreSQL 16 local con sustitutos de `auth.uid()` y roles. NO es Supabase real.**

Scripts: `scripts/test-pending-sql.sh` (58 pruebas) y `supabase/tests/pending_live_shape.sql` (forma de tablas leída en solo lectura de Production el 2026-11-01; la FK `storyboards.script_id` real es `ON DELETE SET NULL`, verificada).

Resultado: 58 ejecutadas · 58 pasan · 0 fallan · 0 omitidas.

Cubierto: aplicación de las 5 propuestas y sus 5 rollbacks; reserva atómica de gasto (20 sesiones → exactamente el tope; mismo request_id ×10 → 1 + 9 duplicate; permisos revocados; RLS de lectura); locks de transcripción (12 workers → 1 ganador, caducidad, dueño); índice único de subtítulos (10 inserts → 1; otros usuarios/tipos libres); storyboard desde guion (idempotencia, reanudación, aislamiento); reorder atómico (permutaciones, rechazos sin efecto, 12 concurrentes sin deadlock); borrados cascade/SET NULL.

## Defecto de concurrencia y su regresión
`create_storyboard_from_script` (select-then-insert sin bloqueo) con 10 llamadas simultáneas creaba 2 storyboards y 4 escenas. Corregido con `pg_advisory_xact_lock(hashtextextended('storyboard_from_script:'||script_id, 0))` al inicio. Regresión explícita: 10 sesiones → 1 storyboard y 2 escenas. Además se verifica que: (a) el lock de un guion NO bloquea a otro guion (21 ms con el otro retenido 4 s) y sí bloquea al mismo; (b) tras una llamada fallida no queda ningún advisory lock (el lock es de transacción, se libera al abortar); (c) la clave es determinista y 100 000 guiones distintos dan 100 000 claves distintas (hash de 64 bits; con prefijo propio que no choca con el lock de gasto).

## Límites
No valida Supabase Auth, Storage ni Realtime. Nada aplicado en Supabase; Production solo con consultas de lectura.
