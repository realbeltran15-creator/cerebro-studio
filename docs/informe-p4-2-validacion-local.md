# P4.2 — Validación local de integración y preparación de beta
Rama `fase1-seguridad` (local, sin push) · 0 € · Production solo lectura · sin migraciones aplicadas.

## 1. PostgREST 12.2.3 REAL + @supabase/postgrest-js REAL
`scripts/test-postgrest-integration.sh` → **38 ejecutadas · 38 pasan · 0 fallan · 0 omitidas**.
**Los JWT los firma el test (HS256, secreto de prueba aleatorio): NO es Supabase Auth.** Se prueba lo que PostgREST hace con un JWT (rol, claims, `auth.uid()`, expiración, firma), no el login/refresh/registro de Supabase.
Cubierto: JWT con secreto equivocado y caducado → 401; anon sin lectura/escritura; RLS select/insert (with check → 42501)/update/delete (0 filas) entre dos usuarios; libro de gasto (authenticated no escribe ni llama a la RPC; anon tampoco; service_role sí); consultas, inserciones, actualizaciones, borrados en cascada/SET NULL; errores de unicidad (23505); payloads malformados → 4xx con PostgREST vivo.

## 2. Integridad y concurrencia por HTTP real
- Storyboard idempotente: 10 RPC HTTP concurrentes → 1 storyboard, 2 escenas; usuario B → `script_not_found`.
- Reorden de escenas: éxito, conjunto incompleto/ajeno → `scene_set_mismatch` sin cambiar nada; B no puede reordenar ni borrar.
- Reserva económica: 20 reservas HTTP simultáneas (service_role) con tope 5 → exactamente 5; A ve su gasto, B ninguno.
- Locks de transcripción: 12 workers por HTTP → 1 ganador; liberar con dueño equivocado no libera; tras liberar otro adquiere; authenticated/anon no pueden llamar.
- Recuperación ante fallos: una RPC que falla a mitad deja 0 storyboards (rollback atómico) y el reintento correcto funciona.
- Acceso no autorizado: anon no crea ni reordena; un `sub` desconocido no ve ni crea datos ajenos.

## 3. Biblioteca y almacenamiento (SUSTITUTO)
`scripts/test-s3-local.sh` + `tests/integration/s3-local.test.ts`: el código REAL de `lib/storage` (`R2_ENDPOINT`) contra **moto (servidor S3 local en Python)**. **No es Supabase Storage ni Cloudflare R2**: no se declara validado ninguno de los dos.
Resultado: 9 ejecutadas · 7 pasan · 0 fallan · 2 omitidas (declaradas).
Pasan: subida/descarga/borrado con SHA-256 idéntico (5 MB), borrado repetido tolerado; otro usuario no puede leer/escribir/borrar rutas ajenas (incluye traversal); multipart 70 MB en 3 partes byte a byte; multipart interrumpido (partes 1–2 listadas, se reanuda solo la 3, resultado idéntico); abortar libera y completar una subida abortada falla; limpieza (huérfanos solo si no referenciados, >24 h y fuera de `versions/`; el borrado ignora claves no listadas); servidor caído → error y sin ruta guardada.
Omitidas (no verificables con sustitutos): rechazo de firma SigV4 alterada/caducada por el servidor (moto no valida firmas; s3rver aceptó una alterada) — la firma se valida con el vector oficial de AWS (`tests/storage.test.ts`); límite de bytes por parte firmado (content-length).
Sin probar: políticas reales del bucket `generated-assets`, límite de 50 MB de Supabase Free, URLs firmadas de Supabase, CORS de R2.

## 4. Beta privada
Ver `docs/beta-privada-alcance.md` (funciones sin pago, desconectadas y bloqueantes reales).

## 5. Validación final (ver resultados al pie)
| Comprobación | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | limpio |
| Vitest completo | 157 archivos pasan · 1504 tests pasan · 22 omitidos (los 9 de S3 local solo corren con `scripts/test-s3-local.sh`) · 0 fallos |
| Build en entorno limpio | OK |
| Chromium (Supabase SIMULADO) | 704 OK · 0 fallos · 0 omitidas |
| PostgreSQL local (sustitutos) | RESUMEN: ejecutadas 58 · pasan 58 · fallan 0 · hallazgos de diseño 0 · (PostgreSQL local con sustitutos, NO Supabase real) |
| PostgREST real + postgrest-js | RESUMEN: ejecutadas 38 · pasan 38 · fallan 0 · (PostgREST real + postgrest-js real; JWT firmados por el test, NO Supabase Auth; sin Storage/Realtime) |
| Almacenamiento (moto, sustituto) |       Tests  7 passed | 2 skipped (9) |

## 6. Clasificación
- **Real**: PostgreSQL 16, PostgREST 12.2.3, cliente postgrest-js, FFmpeg, Chromium, código de `lib/storage`.
- **Simulado/sustituto**: Supabase Auth (JWT propios), Supabase Storage y R2 (moto), Supabase en el navegador (mock), `auth.uid()`/roles (stubs).
- **Pendiente**: login real, Storage real, bucket/políticas, OAuth Google, recorrido manual autenticado, realtime vs vista previa, WebM/MP4 local, SQL en Supabase real.
