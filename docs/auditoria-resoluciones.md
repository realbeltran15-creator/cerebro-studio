# Resoluciones de la auditoría de Investigación — sesión de código

Una fila por hallazgo de `docs/auditoria-investigacion.md`. Esta sesión solo escribe aquí.
Estado: `corregido` (commit que lo resuelve, con su prueba de regresión) · `no reproducible` · `requiere decisión`.

| Hallazgo | Estado | Commit | Causa estructural | Prueba de regresión |
|---|---|---|---|---|
| (los 13 problemas de la primera auditoría) | ver abajo | `c70dfd7`, `53db55d` | — | `tests/research-engine.test.ts` |

## Correcciones ya hechas sin número de hallazgo
Estas respondieron a la lista en el encargo (el archivo original de la auditoría nunca llegó al repositorio).

| Problema | Causa estructural | Commit | Prueba |
|---|---|---|---|
| Emisiones en directo mal identificadas | `liveStreamingDetails` existe también en emisiones terminadas y estrenos; se trataban como «directo» | `c70dfd7` | «only an on-air or scheduled stream is a "directo"» |
| Canales VEVO / discográficas como «canal pequeño» | La ratio vistas/suscriptores se usaba sin comprobar que la cifra de suscriptores describa la audiencia | `c70dfd7` | «VEVO / label channels…» |
| Secciones Shorts/largos con vídeos del formato contrario | La preferencia de formato solo ordenaba, no filtraba | `c70dfd7` | recomendaciones estrictas |
| Nichos mal clasificados | Coincidencia por subcadena (`invest` en `investigation`, `tier` en `frontier`) | `c70dfd7` | «niche words match whole words» |
| Pérdida de información al guardar | Solo se guardaban cifras y URLs | `c70dfd7` | `saveAnalysis` guarda `snapshot` |
| Cuota infravalorada | El contador solo veía análisis; búsquedas y listas no | `c70dfd7`, `53db55d` | «the browser ledger…», «searches and charts are recorded…» |
| Mismo vídeo contado dos veces (top y recientes) y directos en los índices | Las dos muestras se usaban sin limpiar | `53db55d` | «a video present in both samples counts once…» |
| Doble gasto por doble clic / dos pestañas; presupuesto sin atomicidad | Comprobación de presupuesto y escritura no eran atómicas | `53db55d` | «two simultaneous identical requests…» |
| Análisis ya pagado perdido si fallaba la caché | `put` lanzaba excepción tras gastar la cuota | `53db55d` | «a failed cache write…» |
| Análisis caducados tratados como gratis | El cliente no miraba la fecha | `53db55d` | «analyses older than the cache lifetime…» |
