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

## Calidad de datos (auditoría real del 2026-10-15)
Los archivos `auditoria-investigacion.md`, `investigacion-datos-2026-10-15.csv` y las capturas **no llegaron al repositorio ni a esta sesión**: se corrigió con los ejemplos descritos en el encargo. Pendiente de contrastar con los originales.

| Hallazgo | Causa estructural | Corrección | Prueba de regresión (`tests/research-relevance.test.ts`) |
|---|---|---|---|
| «ISA explained» devuelve contenido religioso indonesio | `search.list` es una búsqueda difusa (también por descripción y etiquetas); `regionCode`/`relevanceLanguage` solo sesgan el orden; ningún resultado se juzgaba antes de contar | Cada vídeo se juzga (`lib/research/relevance.ts`): idioma del mercado (declarado y detectado, gana la lectura segura del texto), cobertura de los términos del tema, conflicto de nicho (releído SIN las palabras de la consulta) y directos. Lo descartado se muestra con su motivo | «audit example 1» |
| «first time buyer UK» incluye coches | Las palabras de la consulta daban por buena la categoría («first time buyer» es finanzas, pero «best first time buyer cars» es motor) | El nicho del vídeo se vuelve a leer sin los términos de la consulta; un dominio incompatible lo descarta (`nicho`) | «audit example 2» |
| País e idioma | Se asumía que `regionCode` implica pertenencia | Idioma verificado; el país del canal (`channels.list`) se muestra como dato (cuántos canales declaran el país), no se usa para incluir/excluir | «country and language…» |
| Demanda distorsionada | Anuncios, virales y resultados ajenos entraban en la mediana | Promociones y virales atípicos (Q3+3·IQR y >10× mediana) quedan fuera de la demanda; un vídeo con >50 % de las vistas baja la confianza; confianza baja ⇒ nunca «oportunidad» | «demand: ads, viral outliers…» |
| Crecimiento incorrecto (recientes vs más vistos del año) | Muestras no comparables: ordenación y edad distintas | `growth` es **No calculable** por defecto (índice `null`, nunca 50). «Medir crecimiento» (+102 unidades) compara dos ventanas seguidas de igual duración con ≥ 8 vídeos relevantes en cada una; el alza solo se afirma con ×2 o más por el sesgo de edad | «growth: comparable windows…» |
| Umbrales de recomendación | Se mostraban «los mejores de la lista» aunque fueran malos | Umbrales explícitos (`THRESHOLDS`) impresos en cada sección; nada con confianza baja; una sección puede quedar vacía | «recommendations: real thresholds…» |
| Shorts / vídeos largos / directos | Duración ≤ 60 s = Short; `liveStreamingDetails` = directo | #shorts en título, etiquetas o descripción = Short confirmado; ≤ 60 s solo = «probable»; clips, tráileres y vídeo musical de ≤ 60 s no son Short; se cuentan confirmados / probables / no-Short | «formats: duration alone…» |
| Guardado desde recomendaciones perdía datos y duplicaba | La tarjeta de recomendación guardaba un registro reducido con otro `source_id` | Guarda el análisis completo con el mismo id que la tarjeta de Nichos | «saving keeps the whole analysis…» |
| Análisis antiguos reutilizados | Podían contener vídeos ajenos | Clave de caché `v2` y descarte local de análisis sin `quality`/`growth` | — |

### Campañas
| Hallazgo | Corrección | Prueba (`tests/campaigns.test.ts`) |
|---|---|---|
| Campaña orgánica con presupuesto 0 podía sugerir subir gasto | Reglas propias orgánicas (solo tiempo/cadencia); sin sugerencias de presupuesto; el informe dice «No se recomienda gastar» | «an organic campaign with budget 0 never recommends spending…» (6 tipos de proyecto) |
| Se recomendaba concentrar pero el reparto no lo reflejaba | `shouldConcentrate` decide la sugerencia **y** el reparto; con concentración el 90 % va a la mejor plataforma y las demás quedan «en espera»; la excepción es explícita y queda en el informe | «a recommendation to concentrate is reflected in the split…» |
| Objetivos poco realistas | `feasibilityOf`: realista / ambicioso / poco realista frente a los escenarios, con el presupuesto necesario y la explicación objetivo ≠ estimación | «unrealistic goals are detected…» |
| Estrategia genérica | Playbooks por tipo (lo-fi, Shorts, canal largo, e-commerce, producto digital): plataformas, formatos, creatividades, KPI, avisos y reglas propias; detectado por nombre/tema y editable | «the project kind changes platforms…» |

## Validación real del commit `4283def` (2026-10-15)
| Hallazgo | Causa estructural | Corrección | Prueba |
|---|---|---|---|
| «ISA explained» (GB): 5 de 9 vídeos contabilizados no eran financieros (religión, unidad militar, videojuegos) | La coincidencia de palabras no distingue significados: solo se descartaba lo que *contradecía* el tema, nunca se exigía una prueba del sentido buscado | `lib/research/relevance.ts`: tabla de sentidos por término ambiguo (ISA, HSA, ETF, Super, IRA, FIRE) con las palabras que delatan cada sentido en título, etiquetas, descripción y canal; el vídeo elige el sentido con más pruebas y el veredicto cita las palabras. Tres estados: **aceptado**, **descartado** (motivo verificable) y **dudoso** (nada confirma el sentido: fuera de las métricas, no se llama erróneo). Para consultas fuera de la tabla, detección por datos: si ≥ 20 % de la muestra apunta a otros dominios, cada vídeo debe confirmar el sentido buscado. Confianza baja si ≥ 30 % son dudosos | `tests/research-relevance.test.ts` («meaning disambiguation…», 20 pruebas: ISA, HSA, ETF, Super, varios significados) |
| Solo se veían 5 descartados | Se guardaba una lista de ejemplos | `analysis.sample`: **todos** los vídeos examinados con estado, motivo, enlace, vistas, muestra y formato. Inspector en Nichos con filtros y CSV | prueba de transparencia + 4 comprobaciones de navegador |
| Visualizaciones calculadas como clics | Todas las metas multiplicaban clics × conversión | Visualizaciones e interacciones = impresiones × tasa (editable); suscriptores/contactos/ventas siguen siendo clics × conversión | «views are a share of IMPRESSIONS…» |
| Reglas con divisiones o referencias a cero | Objetivo 0 aceptado; coste objetivo sin comprobar | Objetivo > 0 o `null`; el texto nunca cita un coste 0 | «no rule… refers to zero» |
| «Planner digital» = ecommerce | El respaldo por tipo de sujeto (producto → ecommerce) | Bienes digitales (planner, plantillas, curso, ebook…) antes que tienda física | «Planner digital is a digital product» |
| Coste por resultado en campañas orgánicas | KPI de respaldo común | KPI de coste solo en plataformas de pago | «organic platforms never show a cost…» |
| Google Ads recomendado para lo-fi | Se sugería por puntuación aunque el propio enfoque lo desaconsejaba | `paid: 'desaconsejado'`: no se sugiere; si el usuario lo elige, aviso (≤ 20 %) | «lo-fi… never recommends Google Ads» |
| Reglas duplicadas en mixtas | Conjuntos de pago, orgánico y del tipo de proyecto se sumaban | `dedupeRules` (mismo tipo y ≥ 50 % de palabras) y etiqueta de ámbito (pago / orgánico / ambos) | «a mixed campaign has no duplicated rules» |
| Nombres internos de variables en pantalla | Mensajes de error con `<code>VARIABLE</code>` | Frase en lenguaje llano y los nombres tras «Detalles técnicos» (`AdminHint`) | `tests/ui-polish.test.ts` |
| Miniaturas preseleccionaba un modelo de pago | «Automático» = mejor calidad/coste entre todos | `autoPick`: solo gratuitos; los de pago se eligen y se confirma el coste | «Miniaturas: the default model is never a paid one» |
| Estados técnicos de Conectores (`ready`, `unconfigured`, «Runtime») | Códigos internos mostrados tal cual | «Listo para usar» / «Falta configurarlo» / «Funciona con problemas» con una explicación | `tests/ui-polish.test.ts` |

### Archivos de la sesión de navegador
`auditoria-navegador-docs.zip` y `0001-auditoria-navegador.patch` **no están accesibles** en esta sesión (comprobado: sistema de archivos del contenedor y todas las ramas remotas). Cuando lleguen: el `.zip` se descomprime en una carpeta aparte y su documentación se copia a `docs/` sin tocar código; el `.patch` solo se aplicaría con `git apply --check` previo y revisando que no pise archivos de desarrollo.
