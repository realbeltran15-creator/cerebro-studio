# Auditoría P0.1 — Investigación · Radar · Oportunidades

Alcance: revisión de código + tests de las tres pantallas, correcciones puntuales y pruebas con fixtures (sin llamadas reales, sin gasto: 0 €). Las puntuaciones son una **evaluación interna** con la rúbrica de ChatGPT, no una medición externa. No se probó en un navegador con datos reales de YouTube (requiere credenciales/cuota): lo simulado está marcado como tal.

## Hallazgos y matriz
| Pantalla / función | Estado anterior | Fallo / hueco | Corrección | Prueba | Estado final |
|---|---|---|---|---|---|
| Oportunidades · Crear proyecto | Creaba el proyecto con título, consulta y notas | Perdía la **URL de la fuente**, el mercado y la fecha de lectura; si el vínculo oportunidad↔proyecto fallaba, el error se ignoraba y un segundo clic creaba un proyecto **duplicado** | `lib/opportunity-project.ts` (borrador con procedencia); el vínculo comprueba error; antes de crear se relee `project_id` y se reutiliza el proyecto existente | `tests/opportunity-project.test.ts` (4, fixtures) | Corregido |
| Oportunidades · Frescura | Mostraba la fecha de lectura | Sin aviso de datos viejos | `metricsFreshness`: >7 días = «Desactualizado» (y se anota en el proyecto) | idem | Corregido |
| Oportunidades · Fuente | Enlace solo si http(s) | OK (no se enlaza `javascript:`) | Sin cambio; se verifica en test | idem | OK |
| Radar · Procedencia | Texto «según YouTube» | La lectura actual no mostraba hora ni fuente; popularidad vs crecimiento no estaba explicada junto a los datos | Línea de procedencia: fuente (YouTube Data API), hora de la lectura, popularidad absoluta vs crecimiento relativo, «indicios, no predicciones» | tsc + build | Corregido |
| Radar · Comparación entre lecturas | Calculada (nuevo/sube/baja), con histórico | — | Sin cambio | `tests/radar-history.test.ts` existente | OK |
| Investigación · Separación observado/calculado/estimado | Ya separado y etiquetado; ~25 archivos de tests (cuota, red, geo, ingresos, duplicados) | No se encontraron métricas fabricadas ni afirmaciones de viralidad en la pantalla | Sin cambio | tests existentes | OK |
| Investigación → Proyecto/guion | Vía «Guardadas» + Oportunidades | Dos pasos; sin comparador de oportunidades | **Pendiente** (ver mejoras) | — | Parcial |

## Ronda 2 (implementado)
- Comparador de 2–4 oportunidades (`lib/opportunity-explain.ts`, tabla accesible con desplazamiento horizontal en móvil; «Sin datos suficientes» donde falta información).
- «¿Por qué aparece aquí?» por oportunidad: observado / calculado / estimado (siempre vacío) / datos que faltan / riesgos; nivel de evidencia = recuento de evidencias comprobables (X/5), **no** probabilidad ni viralidad.
- «Crear guion» (`lib/opportunity-script.ts`): crea o reutiliza proyecto y guion, conserva fuente/mercado/fecha, borrador vacío (sin IA), sin duplicados por doble clic/carrera (unique project_id+version), nunca sobrescribe.
- Pruebas: `tests/opportunity-script-compare.test.ts` (11, fixtures/dobles; **simuladas**, sin Supabase real).

## Pendiente / mejoras futuras (tras ronda 2: puntos 4 y 5 siguen abiertos) (no hechas, no se declaran como hechas)
1. Comparador de 2–3 oportunidades lado a lado (evidencias, datos que faltan, riesgos).
2. Cada recomendación con «evidencias · datos que faltan · riesgos» de forma explícita.
3. Botón «Crear guion» directo desde la oportunidad (hoy hay que pasar por el proyecto).
4. Prueba manual en navegador con datos reales cuando exista cuota/credenciales (bloqueado a propósito).
5. Revisión de teclado/móvil con herramienta de accesibilidad (no ejecutada).

## Puntuación interna (orientativa)
Reevaluación tras la ronda 2 (sin subir notas por haber añadido funciones; solo por lo verificado):
- **Oportunidades 89**: lógica 23/25 (conversión sin duplicados, probada con dobles), integración 18/20 (fuente→proyecto→guion), UX/accesibilidad 12/15 (checkbox, details, tabla con aria; sin auditoría automática ni prueba móvil real), estados/errores 14/15, seguridad 10/10 (RLS existente), costes 10/10 (0 €), rendimiento 4/5 (recalcula explicaciones en cada render).
- **Radar 86** sin cambios: falta prueba con datos reales (bloqueada) y evidencias de accesibilidad.
- **Investigación 88** sin cambios: no se tocó.
Ninguna llega a 90. Lo que lo impide: (1) no hay prueba manual en navegador con datos reales; (2) no se ejecutó auditoría de accesibilidad con herramienta ni prueba en móvil real; (3) Investigación→guion sigue en dos pasos (se resuelve vía Oportunidades). Sin fallos críticos de seguridad, pérdida de datos, gasto o publicación detectados.

## Validación
Ver el informe en el chat: tsc, suite completa, `next build`.
