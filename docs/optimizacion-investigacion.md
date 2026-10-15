# Optimización avanzada del módulo Investigación — informe técnico

Rama `feat/creation-studio` (PR #12, Draft). Nada de esto se ha desplegado en Producción ni se ha aplicado a la base compartida.

## 1. Auditoría del motor: problemas detectados

| # | Problema | Efecto | Estado |
|---|---|---|---|
| 1 | La búsqueda de YouTube es difusa y todos sus resultados entraban en las métricas (p. ej. «ISA explained» → vídeos religiosos, militares, de videojuegos) | Demanda y competencia calculadas sobre vídeos de otro tema | Corregido: cada vídeo se juzga antes de contar (`relevance.ts`) |
| 2 | Palabras con varios significados (ISA, HSA, ETF, IRA, FIRE, Super) se resolvían solo por las palabras de la consulta | Falsos positivos (5 de 9 no financieros en la validación real) | Corregido: tabla de sentidos + cita de las palabras vistas; lo no confirmado es «dudoso» |
| 3 | Frases como «first time buyer UK» daban coches | Nicho equivocado | Corregido: el nicho se relee **sin** las palabras de la consulta |
| 4 | Sin comprobar el idioma | Vídeos de otro idioma contaban | Corregido: idioma declarado + detectado; la lectura segura del texto manda |
| 5 | Anuncios con millones de vistas y virales atípicos fijaban la demanda | Demanda inflada | Corregido: se detectan y salen del cálculo (Q3 + 3·IQR y > 10× la mediana) |
| 6 | Un solo vídeo con > 50 % de las vistas no bajaba la confianza | Tema «grande» por un golpe aislado | Corregido: baja la confianza; ahora además se clasifica la demanda como «puntual» |
| 7 | El crecimiento valía 50 por defecto | Cifra inventada | Corregido: «No calculable» salvo dos ventanas adyacentes de igual longitud con ≥ 8 vídeos relevantes cada una; el peso se reescala |
| 8 | Shorts detectados solo por duración | Clips y tráileres contados como Shorts | Corregido: `#shorts` = confirmado; solo duración = probable; clips = «corto» de baja confianza |
| 9 | Competencia = tamaño del canal mediano + cuota del primero | Un nicho de 3 canales gigantes entre muchos pequeños parecía abierto | Corregido: concentración (HHI y 3 mayores) y dificultad de entrada |
| 10 | Pesos y umbrales repetidos en el código y en los textos | Explicación que puede divergir del cálculo | Corregido: `METHOD` en `statistics.ts`; los textos se generan desde ahí |
| 11 | La demanda no distinguía «un éxito» de «interés sostenido» | Recomendar temas de un solo vídeo | Corregido: `demandProfile` |
| 12 | Sin análisis de sensibilidad ni intervalo | Puntuaciones con falsa precisión | Corregido: sensibilidad ±15 puntos y pesos iguales; intervalo del ~95 % de la mediana |
| 13 | Recomendaciones rellenaban secciones con la «mejor de una lista floja» | Apuestas sin base | Corregido: umbrales impresos, confianza baja nunca se recomienda, las secciones pueden quedar vacías |
| 14 | Monetización ordenada por el RPM medio | Optimista; el RPM es una estimación de terceros | Corregido: se ordena por el extremo **bajo** y se rotula ESTIMADO; sin estimación = desconocido |
| 15 | Canales de discográficas y ratios absurdos (> 500 vistas por suscriptor) aparecían como «canal pequeño que triunfa» | Falsos hallazgos | Corregido (`isLabelChannel`, `MAX_PLAUSIBLE_RATIO`), y ahora también en `smallChannelWins` |
| 16 | La cuota se contaba por día UTC | YouTube reinicia a medianoche del Pacífico: desfase de 7–8 h | Corregido: `quotaDayStart` |
| 17 | Deduplicación solo dentro de una instancia de Vercel; la comprobación de presupuesto no era atómica | Dos instancias podían pagar lo mismo y pasarse del tope | Corregido en código y SQL (**sin aplicar**): concesión exclusiva + reserva atómica |
| 18 | Si fallaba la 2.ª búsqueda se perdía la 1.ª (102 unidades) | Gasto duplicado al reintentar | Corregido: reutilización parcial 1 h |
| 19 | Sin forma de ver por qué se aceptó o descartó un vídeo | Resultados no auditables | Corregido: inspector de muestra con motivo y palabras citadas |

Pruebas que pasan no significan «terminado»: los problemas 1, 3, 7, 9 y 17 los encontró la validación real, no los tests.

## 2. Metodología por métrica (todo calculado, nada medido por YouTube salvo lo indicado)

Pesos y umbrales viven en `lib/research/statistics.ts` (`METHOD`); la pantalla «Qué tan firme es y cómo se calcula» los imprime desde ahí.

- **Relevancia (por vídeo)**: idioma → cobertura de los términos del tema (título/etiquetas 1, descripción 0,5; mínimo 75/67/60 % según nº de términos) → significado (tabla `SENSES`) → nicho releído sin las palabras de la consulta → directos fuera. Resultado: aceptado / dudoso / descartado con motivo. Los «dudosos» se comparan después, **en local y sin coste**, con los vídeos confirmados (TF-IDF + coseno, ≥ 3 semillas, margen ≥ 0,08, similitud ≥ 0,2, ≥ 3 palabras informativas); si no hay base, siguen dudosos.
- **Demanda (0–100)**: mediana de vistas/día de los vídeos relevantes (sin anuncios ni virales atípicos): 60 % lo más visto del último año + 40 % lo reciente (≥ 3 días); escala log, 100 = 20 000 vistas/día; < 25 = sin demanda. **Tipo**: sostenida / puntual / insuficiente (ningún vídeo > 50 % de las vistas, virales < 25 % de la muestra, lo reciente ≥ 30 % del ritmo anual).
- **Oferta (0–100)**: 60 % subidas por semana (escala log, 100 = 100/sem) + 40 % canales distintos (100 = 25).
- **Competencia (0–100)**: 40 % tamaño del canal mediano (log, 100 = 5 M) + 35 % canales ≥ 100 000 suscriptores en el top 10 + 25 % cuota del canal dominante. **Concentración**: HHI de las vistas por canal (≥ 2 500 o 3 mayores ≥ 75 % = alta). **Dificultad de entrada**: puntos por competencia, concentración y oferta; restan los canales pequeños (< 20 000) cuyos vídeos superan sus suscriptores; «sin datos» si no hay base.
- **Crecimiento**: solo con dos ventanas adyacentes de igual longitud y ≥ 8 vídeos relevantes cada una; «al alza (posible)» con razón ≥ 2, «a la baja» ≤ 0,75; en otro caso «No calculable» (cuesta +102 unidades medirlo).
- **Oportunidad (0–100)**: 45 % demanda + 25 % competencia abierta + 20 % oferta abierta + 10 % crecimiento; sin crecimiento, los otros tres se reescalan al 100 %; con demanda < 25 el máximo es 20. Veredicto «oportunidad»: demanda ≥ 50, competencia ≤ 55, oferta ≤ 60 y confianza no baja; «saturado»: demanda ≥ 50 y competencia > 70 u oferta > 75.
- **Sensibilidad**: se recalcula con ±15 puntos en demanda, competencia y oferta y con pesos iguales; «estable» si el veredicto no cambia y la oscilación ≤ 20 puntos.
- **Confianza**: baja si hay < 10 vídeos relevantes en el top o < 5 en lo reciente, si se descartó > 60 % de los resultados, si ≥ 30 % son dudosos o si un vídeo reúne > 50 % de las vistas. La confianza baja nunca produce «oportunidad» ni se recomienda.
- **Monetización**: nunca hay RPM observado (la API pública no lo da). Se muestra el rango **estimado** del sector (de fuentes de terceros, rotulado ESTIMADO) y se ordena por su extremo bajo; sin estimación = desconocido. No se presentan ingresos como verificados.
- **Huecos detectados** (`opportunities.ts`, sin consultas nuevas): demanda con poca oferta · canales pequeños que funcionan · lo más visto es antiguo · tema al alza (solo con crecimiento medido) · hueco por idioma · diferencia entre países (solo si los mercados son comparables y la diferencia ≥ 15) · preguntas del público y búsquedas flojas (**«a verificar», nunca oportunidad**). Que no haya vídeos nunca cuenta como demanda; cada hueco cita vídeos reales con miniatura y enlace, dice qué podría fallar y el siguiente paso.
- **Comparación internacional** (`markets-info.ts`): cada pareja de mercados es *comparable*, *comparable solo en parte* (idiomas o términos distintos, confianza baja, idioma sin verificar) o *no comparable* (ventanas distintas o < 20 vídeos). `regionCode` solo orienta los resultados: no prueba dónde viven espectadores ni creadores. Las notas por país (EE. UU., Reino Unido, Canadá, Australia, Alemania, Suiza) son conocimiento editorial rotulado como tal, no datos de YouTube.

## 3. Cuota estimada

| Acción | Unidades |
|---|---|
| Análisis de un tema en un mercado (2 búsquedas) | ≈ 204 |
| Medir crecimiento (ventana anterior) | ≈ 102 |
| Búsqueda libre | ≈ 102 |
| Lista oficial de tendencias de un país | ≈ 2 |
| Un tema en los 6 mercados (US, DE, AU, GB, CA, CH) | ≈ 1 224 |
| Tope diario de la app (por defecto) | 6 000 → ≈ 29 análisis/día |
| Cuota diaria oficial del proyecto (compartida) | 10 000 |

La reserva local **no es** la cuota oficial; la consola de Google Cloud es la que manda (ver `informe-persistencia-research-cache.md` §4). Todo este trabajo se probó sin una sola llamada a YouTube.

## 4. Pruebas de regresión (todas SIMULADAS)

Ninguna llama a YouTube. Los ejemplos de la auditoría real se reproducen como datos de prueba construidos a partir de lo que se observó; son simulados, no capturas en vivo.

| Caso pedido | Dónde |
|---|---|
| «ISA explained» con vídeos religiosos/militares/juegos | `research-relevance.test.ts` · «ISA (UK) — the contamination…» |
| «first time buyer UK» con coches | `research-relevance.test.ts` · «audit example 2» |
| Vídeos en otro idioma | `research-relevance.test.ts` · «audit example 1» y «country and language» |
| Anuncios con millones de vistas | `research-relevance.test.ts` · «demand: ads, viral outliers…» |
| Canales con estadísticas engañosas | `research-statistics.test.ts` · «misleading statistics» |
| Nicho saturado clasificado como competencia baja | `research-statistics.test.ts` · «saturated niche is never baja», `research-opportunities.test.ts` |
| Shorts mal identificados | `research-relevance.test.ts` · «formats: duration alone does not prove a Short» |
| Crecimiento no calculable | `research-relevance.test.ts` · «growth: comparable windows or No calculable» |
| Consultas duplicadas entre instancias | `research-engine.test.ts` · «coordination across server instances»; SQL real: `scripts/test-migrations.sh` (8 sesiones) |
| Guardar y recuperar investigaciones | `research-engine.test.ts` (persistencia), `tests/browser` (recarga) |
| Semántica local, huecos, mercados, ficha | `research-relevance.test.ts`, `research-opportunities.test.ts`, `research-markets.test.ts` |

**Con base de datos real (local, desechable)**: las funciones SQL y su concurrencia (PostgreSQL 16). **Con datos reales de YouTube**: ninguna — es lo que debe validar la sesión de navegador.

## 5. Limitaciones conocidas

- Muestras de 25 vídeos por consulta, no un censo; YouTube no permite contar vídeos ni creadores.
- La semántica local es léxica (TF-IDF): no entiende sinónimos que no aparezcan en los textos; ante la duda deja «dudoso».
- Las tablas de sentidos, de sinónimos y las notas por país están escritas a mano y cubren lo que se ha visto; no son exhaustivas.
- Las funciones SQL y su atomicidad **no están en la base compartida** hasta que se autorice la migración; entre instancias reales de Vercel solo hay pruebas simuladas y de sesiones SQL en local.
- No se ha probado PostgREST (RPC desde supabase-js) contra un Supabase real.
- El RPM sectorial es una estimación de terceros.
- No se ha podido aplicar el parche ni usar los archivos de la sesión de navegador (`.zip`, `.patch`, auditoría, CSV): nunca llegaron al repositorio.

## 6. Para autorizar `research_cache`

1. Revisar `docs/informe-migraciones.md` y `supabase/migrations/20261013120000_research_cache.sql` (tabla + 3 funciones).
2. Autorizar su aplicación a la base compartida (afecta a Preview y Producción por compartir proyecto; es aditiva y reversible con `supabase/rollback/20261013120000_research_cache.down.sql`).
3. Tras aplicarla: comprobar que `research_reserve`/`research_lock` responden vía PostgREST y que `select count(*) from research_cache` funciona con un usuario real; `campaigns` sigue sin aplicarse hasta nueva orden.

## 7. Verificaciones que debe hacer Claude Chat con datos reales

Con pocas consultas (no masivas; ≈ 204 unidades cada una):
1. «ISA explained» (GB, en): comprobar en el inspector de muestra que ningún vídeo religioso, militar o de juegos queda como «aceptado», y que los «dudosos» y los aceptados «por contexto» (con su similitud citada) tienen sentido.
2. «first time buyer» (GB): ningún vídeo de coches aceptado.
3. Un tema claro (p. ej. «index funds») en US y GB: la comparación entre mercados marca «comparable» y los huecos citan vídeos reales con miniatura.
4. Medir crecimiento en un tema ya analizado: coste +102 y etiqueta coherente con las vistas/día reales de cada ventana.
5. Abrir «Qué tan firme es y cómo se calcula»: concentración, tipo de demanda y sensibilidad coinciden con lo visible en los vídeos de ejemplo.
6. Un nicho que el revisor sepa saturado: no debe salir como «oportunidad» ni con dificultad de entrada baja.
7. Comparar la cuota en la consola de Google Cloud con la del indicador de la app tras las pruebas (la discrepancia esperada es pequeña; documentarla).
8. Cambiar de dispositivo y pulsar de nuevo el mismo análisis: sin la migración, no compartirá caché entre dispositivos (esperado); tras autorizarla, sí.
