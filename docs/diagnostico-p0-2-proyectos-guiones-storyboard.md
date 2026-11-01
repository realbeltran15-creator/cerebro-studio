# Diagnóstico P0.2 — Proyectos → Guiones → Storyboard (local, 0 €)

Método: lectura de `app/scripts/page.tsx`, `lib/scripts.ts`, esquema `scripts`/`storyboards`/`scenes` y tests existentes. Sin navegador con datos reales ni Supabase (bloqueado/no autorizado): lo verificado es lógica pura con tests; lo demás es **hallazgo por lectura de código**, marcado como tal.

## Fallos reproducibles (por lectura de código) y estado
| # | Hallazgo | Riesgo | Estado |
|---|---|---|---|
| 1 | `save()` actualizaba por `id` sin comprobar versión: dos pestañas/dispositivos → la última pisa a la primera (pérdida silenciosa de texto) | Pérdida de datos (alto) | **Corregido**: guarda solo si `updated_at` coincide; si no, avisa y no escribe nada |
| 2 | «Convertir en storyboard» no comprobaba storyboards existentes: doble clic, reintento o recarga creaban storyboards duplicados del mismo guion | Duplicados (medio) | **Corregido**: reutiliza el existente y navega a él; guarda `if (busy)` |
| 3 | `lib/scripts.ts` (`normalizeSections`, `scriptWarnings`, `scriptToScenes`, estimación de duración) no tenía ningún test | Regresiones invisibles (medio) | **Corregido**: `tests/scripts-lib.test.ts` (5) |
| 4 | `createFirst`/«Nueva versión»: la versión se calcula en el cliente (`max+1`); dos pestañas → 23505 mostrado como mensaje crudo | UX (bajo) | Pendiente: tratar 23505 como «ya existe» y recargar |
| 5 | `toStoryboard` no es atómico: si fallan las escenas borra el storyboard recién creado (compensación en cliente); un corte de red entre ambos pasos deja un storyboard vacío | Datos huérfanos (medio) | Pendiente: función SQL transaccional (requiere migración → fuera de alcance sin autorización) o limpieza/reuso de storyboards sin escenas |
| 6 | Duraciones de escena = estimación a 150 pal./min marcada `duration_is_estimate` | Correcto (etiquetado) | OK |
| 7 | Fuentes por sección se copian a `scenes.metadata.sources` | Correcto | OK, ahora con test |
| 8 | Asistencia IA de guion tiene coste por petición y se desactiva sin clave | Coste | OK (no probada: requiere clave) |
| 9 | Proyectos (`app/projects`): borrado con `lib/projects/delete.ts` (tiene test); resto de la página sin tests | Cobertura (bajo) | Pendiente de diagnóstico a fondo |
| 10 | Storyboard/escenas se editan en `/create`: no auditado aún (siguiente bloque) | — | Pendiente |

## Plan de correcciones propuesto
1. (Hecho) 1–3.
2. Tratar 23505 en versiones y primer guion como «ya existe» (reutilizar).
3. Reutilizar/limpiar storyboards sin escenas; opción transaccional por RPC cuando se autorice una migración.
4. Auditar `/create` (storyboard y escenas): orden, duración, edición, recuperación de errores, reglas de coste.
5. Auditar `/projects` y `/projects/[id]` (estado, navegación, borrado reversible).

## Validación
tsc limpio · suite y build: ver informe en el chat.
