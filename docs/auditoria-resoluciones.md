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

## Revisión técnica independiente (sin hallazgos de la sesión de navegador)
Un revisor de solo lectura revisó `1f1b029..53db55d`. Resultado y estado:

| Hallazgo | Estado | Prueba de regresión |
|---|---|---|
| Un `refresh` sobrescribía la fila de caché y se contaba una sola vez | corregido: cada llamada de pago registra su uso | «a refresh is counted again» |
| Una consulta con la 2ª búsqueda fallida gastaba cuota no contada | corregido: se registra cada búsqueda al terminar | «a fetch whose second search fails…» |
| El presupuesto del navegador no cambiaba de día a medianoche UTC | corregido (`effectiveUsage` ignora cifras de otro día) | «a ledger or server figure from yesterday…» |
| El tope local bloqueaba aciertos de caché gratuitos | corregido: sin presupuesto se consulta solo la caché del servidor (`cacheOnly`) | revisado en la batería de navegador |
| `Records / Entertainment / Official` excluían canales legítimos | corregido: solo en la categoría Música; VEVO y «- Topic» siempre | «generic label words only exclude…» |
| Rutas con 500 sin JSON si fallaba el almacén | corregido (dentro del `try`; el registro de uso no oculta resultados) | — |
| Calendario roto para campañas de 1–4 días y fase de escala duplicada en 7 | corregido: plan compacto < 7 días, fases sin solapes | «the calendar never overlaps… 1 to 60» |
| `% del objetivo` comparaba métricas distintas (ventas vs vistas) | corregido: solo si coinciden; aviso si no | «scenarios are only compared…» |
| Tope diario 0 («Infinity días»), fechas imposibles, fechas pasadas | corregido | «a zero daily cap…» |
| Plataforma de pago con presupuesto 0 | corregido (aviso propio) | «a paid platform with a zero budget…» |
| StrictMode perdía la campaña creada desde el enlace; `setStatus` sin fecha | corregido | `setStatus` |
| Cola y deduplicación solo valen dentro de una instancia de servidor | **limitación conocida**: en Vercel varias instancias podrían pasar el tope a la vez. Solución futura: comprobación en base de datos (requiere `research_cache` aplicada) | — |
| Contador local con varias pestañas: gana la última escritura | **limitación conocida**; el servidor lo cubre si `research_cache` está aplicada | — |
| Dos pestañas pisan la lista de campañas guardada | **limitación conocida** (almacén local); se resuelve con la tabla `campaigns` | — |
