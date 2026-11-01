# P0.2 — Integridad de proyectos, guiones y storyboards (0 €, local, sin push)

Todas las pruebas son **simuladas** (lógica pura y dobles); no se probó con Supabase real ni en navegador (no autorizado / sin credenciales).

## Matriz de auditoría
| Pantalla / función | Estado anterior | Fallo reproducible (lectura de código) | Corrección | Prueba | Estado |
|---|---|---|---|---|---|
| Guiones · guardar | Update por id | Dos pestañas: la última pisa a la primera, en silencio | Guarda solo si `updated_at` coincide; si no: panel de conflicto con «Copiar mi borrador» y «Cargar la versión guardada»; nunca sobrescribe | lógica en UI (no unitaria) | Corregido |
| Guiones · 1ª versión / nueva versión | Error 23505 crudo | Dos pestañas → mensaje SQL | `classifyScriptInsertError`: solo `(project_id, version)` es recuperable → se abre el guion existente sin modificarlo; otros 23505 → mensaje genérico | `tests/script-integrity.test.ts` | Corregido |
| Guiones → Storyboard | Dos pasos, borraba el storyboard si fallaban escenas | Duplicados por doble clic; corte de red = storyboard vacío; el borrado automático podía perder trabajo | Reanudable: reutiliza el storyboard, inserta SOLO las escenas que faltan (`planStoryboardResume`), respeta ediciones/reordenaciones manuales, no borra nada | 7 tests (completo, parcial, manual, posiciones) | Corregido (límite: ver atomicidad) |
| /projects · crear | Sin guarda | Doble envío creaba dos proyectos; mensajes crudos | Guarda `useRef` + `friendlyDbMessage` | tsc/build | Corregido |
| /create · crear storyboard | Sin guarda | Doble envío = storyboards duplicados | Guarda `useRef` | tsc/build | Corregido |
| /create · guardar escena | `max+1` en cliente | Dos pestañas → 23505 crudo y formulario perdido | 23505 → recarga la lista y conserva el texto del formulario | tsc/build | Corregido |
| /create · mensajes | `error.message` crudo | Filtra detalles internos | `friendlyDbMessage` (permisos, conexión, duplicado) | tests | Corregido |
| lib/scripts.ts | Sin tests | — | 5 tests | `tests/scripts-lib.test.ts` | Corregido |
| /create · editar escena | Update por id | Sin `updated_at` en `scenes`: **no hay token de concurrencia** | — | — | **Abierto** (requiere migración) |
| /create · orden de escenas | Solo se añaden al final | No se pueden reordenar/eliminar escenas desde la UI | — | — | **Abierto** (mejora) |
| Storyboard → Editor | Sin enlace directo | La transferencia al Editor es manual | — | — | **Abierto** (P0.3) |

## Limitación de atomicidad
La reanudación evita duplicados y pérdidas, pero crear storyboard + escenas sigue siendo en dos llamadas: un corte en medio deja un storyboard incompleto que se completa al pulsar de nuevo. La solución transaccional está **preparada para revisión, NO aplicada y sin probar contra base real**: `supabase/pending/20261102120000_storyboard_from_script_rpc.sql` (+ rollback), `security invoker`, sin permisos para `anon`.

## Puntuación interna (orientativa, sin inflar)
Guiones 86 · Proyectos 84 · Storyboard/escenas 80. Ninguna ≥ 90: faltan pruebas reales en navegador/Supabase, token de concurrencia en escenas, reordenar/eliminar escenas, auditoría de accesibilidad/móvil. Sin fallos conocidos de pérdida de datos en el recorrido corregido, salvo el abierto de edición concurrente de escenas.

## Validación
tsc limpio · 133 archivos / 1381 tests OK (13 omitidos) · `next build` OK · coste 0 €.
