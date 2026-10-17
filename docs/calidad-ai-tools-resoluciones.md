# Calidad de resultados tras la primera prueba real («AI tools for beginners», EE. UU., inglés, 30 días)

Corregido sobre `feat/creation-studio` (motor de análisis versión **6**). Los informes `prueba-real-ai-tools-c2b9275.md` y
`diagnostico-failed-to-fetch-c2b9275.md` **no estaban accesibles** (ni en el repositorio, ni en el disco, ni en Drive): se trabajó a partir de los cinco
problemas descritos. Todas las pruebas son con datos **simulados**; ninguna consultó YouTube.

| # | Problema | Causa | Corrección | Pruebas |
|---|---|---|---|---|
| 1 | Ingresos con doble ajuste de RPM por país y atribuidos a EE. UU. | El RPM de los estudios ya parte de audiencia mixta/EE. UU. y `estimateRevenue` lo multiplicaba otra vez por un factor del mercado buscado (hasta ×2 para EE. UU.), aunque el país de los espectadores no es observable. | Se elimina el factor por país: solo se ajusta por formato (Shorts). La estimación declara `verified: false`, el texto dice «HIPÓTESIS… no es una ganancia verificada» y la pantalla lo repite. Solo el RPM propio (YouTube Analytics) lo verificaría y sigue pendiente. | `tests/research-revenue.test.ts` |
| 2 | «Claude», «ChatGPT», «Gemini»… no contaban como herramientas de IA; tutoriales casi idénticos se aceptaban o descartaban según la marca. | El tema `ai tools` exigía las palabras «ai» y «tools» en el vídeo. | Regla de dominio `ia-herramientas` simétrica para ~45 marcas; un nombre en el título cubre las palabras genéricas. Los nombres ambiguos (Claude Monet, Gemini zodiaco, copiloto de avión…) no valen si el título trae una palabra rival. | `tests/research-ai-tools.test.ts` (22) |
| 3 | Demanda inflada por vídeos virales aislados, sobre todo Shorts. | La demanda era una mediana de vistas/día sin medir concentración, nº de canales ni peso de los Shorts. | `demandReliability`: baja o insuficiente si hay <20 vídeos relevantes, <6 canales, un vídeo >40 % o tres >70 % de las vistas, Shorts >50 % de las vistas o muchos atípicos. Reduce el índice (×0,75 / ×0,5), baja la confianza a «baja», impide «oportunidad» y limita la oportunidad mostrada a 49. Se imprime el índice sin ajustar y el ajustado. Nunca «alta». | `tests/research-demand-supply.test.ts` |
| 4 | Oferta = cantidad publicada: un vídeo con 1–28 vistas pesaba igual que uno con tracción. | `supply` usaba todos los vídeos relevantes recientes y todos sus canales. | Oferta competitiva: solo cuentan vídeos con ≥100 visualizaciones (umbral documentado en `METHOD.traction`). Se informan aparte publicados, con tracción, sin tracción, demasiado nuevos (<3 días) y sin cifra. | idem |
| 5 | «Failed to fetch» cuando caduca la sesión de la Preview. | Vercel redirige a su login (otro origen): el navegador no puede seguirlo y solo dice «Failed to fetch». | Las peticiones usan `redirect: 'manual'`; una redirección opaca, un 401 HTML (Vercel) o un 401 JSON (app) se muestran como sesión caducada: la solicitud no llegó, no se ha consultado YouTube, no se cuenta consumo, no se reintenta ni se sigue con la cola. Un corte de red sin respuesta explica que no se puede comprobar el gasto. | `tests/research-session.test.ts` |

## Coherencia puntuaciones ↔ evidencias ↔ clasificación
Probada en cinco muestras (equilibrada, Short viral, muestra mínima, tres canales, sin tracción): el índice de demanda es `round(sin ajustar × factor)`;
`oportunidad` exige confianza no baja, representatividad media y demanda ≥ 50; confianza baja ⇒ oportunidad mostrada ≤ 49; representatividad no media ⇒
confianza baja y aviso en las razones; la oportunidad mostrada coincide con `shownOpportunity(opportunityOf(...))`; nunca confianza «alta». Las
oportunidades (`opportunities.ts`) solo salen de análisis con representatividad media.

## Lo que NO se ha podido verificar
- **Resultados reales guardados:** no hay ninguno accesible (los análisis viven en el `localStorage` del navegador del usuario). Ningún dato real se reutilizó ni se pidió a YouTube.
- **Análisis anteriores (motores 4 y 5):** no se pueden mejorar gratis. La muestra guardada no tiene canales, suscriptores ni descripciones, así que el motor 6 no puede reconstruirlos: se muestran aparte y hay que volver a analizar el tema (204 unidades y 2 búsquedas) cuando se autorice.
- **Redirección de Vercel real:** la detección está probada con respuestas simuladas; no se pudo provocar una caducidad real de la Preview (sin acceso a Vercel ni a una sesión).
- **Umbrales** (100 visualizaciones, 20 vídeos, 6 canales, 40 %/70 %/50 %, factores 0,75/0,5, tope 49) son decisiones de prudencia, no medidas contra datos reales; hay que contrastarlos con la siguiente prueba real.
- **Regla de IA:** lista escrita a mano de marcas (se desactualizará) y de palabras rivales; un tutorial de una herramienta nueva que no esté en la lista seguirá marcándose «dudoso».
- **Ingresos:** sigue siendo una hipótesis sectorial; el nicho `ia` toma el RPM de otros nichos y conserva confianza «muy baja».
