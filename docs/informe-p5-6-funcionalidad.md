# Informe P5.6 — Validación funcional de los 8 módulos «solo carga»

Entorno: pila oficial local de Supabase (sin Docker), app compilada con la beta desactivada, Chromium real, datos sintéticos, 0 € de gasto. Sin ejecutores, cron, publicación ni contactos externos. Prueba: `npm run test:e2e:modules` (28 comprobaciones correctas, 0 fallidas; incluye comprobación de que no se llama a ningún host externo).

| Módulo | Flujo probado | Resultado real | Defectos corregidos | Dependencias | Limitaciones | Estado |
|---|---|---|---|---|---|---|
| Plantillas | Crear desde un montaje, recargar, aplicar a otros vídeos, borrar | Persiste en cuenta; borrar persiste tras recargar | — | Ninguna externa | Los selectores de hueco no filtran por tipo de recurso | Operativo |
| Editar con mi estilo | Analizar clips, generar montaje con estilo | Montaje creado y visible tras recargar | — | FFmpeg local | Estilo derivado de reglas, no de IA | Operativo |
| Montaje automático | Analizar, preparar, reencuadre 9:16, abrir editor | Escenas y duración correctas | — | FFmpeg local | Reencuadre manual por escena | Operativo |
| Repurpose | Buscar momentos con gancho, puntuar, crear borradores | Primer momento 0:00–0:35, potencial estimado con gancho detectado | — | Transcripción aportada por el usuario | Puntuación estimada, no medida | Operativo |
| Workflows | Crear flujo, materiales, estados, recarga | Persiste; atención y aprobación correctas | — | Ninguna | Enlaces a módulos cerrados en la beta | Operativo |
| Calendario | Planificar, reprogramar, quitar fecha | Faltaba poder reprogramar o quitar fecha de borradores con fecha | Nueva sección «Con fecha prevista» con cambio de fecha, «Quitar fecha» y «Abrir» + prueba de regresión | Ninguna | No publica nada | Operativo |
| Costes | Importes ficticios, totales, persistencia | Cálculos correctos, sin llamadas facturables | — | Ninguna | Importes manuales | Operativo |
| Campañas | Brief de 9 preguntas, estrategia, presupuesto, indicadores, informe, recarga, duplicar, eliminar | Presupuesto 300 € = 142,11 + 127,89 + 30 de reserva (cuadra); objetivo irreal (500 vs 8 base) avisado; persiste; duplicar y eliminar funcionan; informe indica que no se publica ni gasta nada | — | Ninguna (no publica anuncios) | Escenarios con supuestos de ejemplo, no datos reales | Operativo |

## Regresiones
tsc sin errores; ESLint 0 errores (140 avisos preexistentes); Vitest 1635 correctas, 22 omitidas; E2E módulos 28/28.

## Observaciones abiertas
- Investigación, Radar y Automatizaciones devuelven 503 esperado sin `YOUTUBE_API_KEY`.
- Infraestructura de la beta sigue bloqueada por el límite Free de Supabase.
- Propuesta `channel_connections` (GRANT por columnas) validada solo en local; no aplicada.
