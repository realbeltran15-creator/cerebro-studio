# Auditoría integral de Investigación (como usuario nuevo) · versión `58808ed` · 16-10-2026

- **Preview:** https://cerebro-studio-git-feat-creation-studio-jesus-e021.vercel.app
- **Versión comprobada:** `origin/feat/creation-studio` = `58808ed`. Marcadores visibles en el despliegue:
  - contador con «unidades» **y** «búsquedas»;
  - pasos 1-2-3-4 sin repetir;
  - sección «Análisis de una versión anterior del motor»;
  - `engineVersion: 3` en los análisis nuevos;
  - libro de consumo con día como fecha (`"day":"2026-10-16"`).
- **Pruebas automáticas de Code:** 5 ficheros, 166 pruebas, todas en verde (`vitest run`).
- **Consumo de esta ronda:**
  - 4 análisis reales y 1 «Medir crecimiento», es decir, 9 búsquedas y 918 «unidades» según la app.
  - Google Cloud al terminar: **Search Queries per day 23 / 100** y **Queries per day 46 / 10.000**.
  - No se ha tocado Production ni se ha hecho merge. No se ha aplicado ninguna migración ni se ha borrado nada.

Ficheros adjuntos:
- `matriz-controles-investigacion.csv`: 38 controles con resultado, gasto y problema.
- `matriz-120-analisis.csv`: las 120 combinaciones con su estado.

---

## 0. Veredicto

**Investigación todavía NO está lista para los lotes de 120.** Ha mejorado mucho:

- el contador ya es fiable y persiste;
- el límite de 100 búsquedas está modelado;
- «Medir crecimiento» funciona;
- los homónimos de ISA se excluyen;
- los hashtags y el español ya se reconocen bien;
- los análisis antiguos se separan.

Quedan dos fallos de fiabilidad (P1) que invalidan conclusiones en 3 de los 6 mercados del plan:

1. **P1-03.** En alemán se excluyen como «dudosos» vídeos que sí son del tema: 19 de 49 en «ETF Sparplan erklärt». Lo he reproducido sin gastar cuota sobre `58808ed`.
2. **P1-04.** El país de búsqueda no garantiza el mercado. En «first time buyer» con Reino Unido, la mayoría de los vídeos aceptados son de EE. UU. y Canadá (solo 9 de 30 canales declaran GB). En «datos curiosos» con España, solo 4 de 40. La demanda que se atribuye al país no es de ese país, y la pantalla no lo penaliza ni avisa de forma visible.

Hay además varios P2 de claridad: unidades sin explicar, textos «de pago» y `discovered`, y avisos técnicos. Un usuario nuevo los nota enseguida.

## 1. Re-validación de lo que Code dice haber corregido

| Corrección de Code | Resultado en Preview | Evidencia |
|---|---|---|
| F-01 · el contador se reiniciaba | ✔ **Corregido** | Tras 4 recargas el contador sigue (204 → 306 → 510 → 714 → 918 u; 2 → 9 búsquedas); `ledger = {"day":"2026-10-16",...}` |
| F-08 · límite de 100 búsquedas | ✔ **Corregido** | La pantalla muestra «X de sus 60 búsquedas»; la cola guiada limita por búsquedas («Hoy manda el límite de búsquedas…») |
| Aviso de cifra no oficial | ✔ | «Es una cuenta de esta aplicación, no la cifra oficial… Comprueba la consola de Google Cloud» |
| F-06 · «Medir crecimiento» | ✔ **Corregido** | ETF Sparplan DE: +102 u y +1 búsqueda. Resultado honesto: «No calculable. Pocas pruebas: 7 vídeos relevantes en los últimos 30 días y 13 en los 30 anteriores (mínimo 8)» |
| V-01 · homónimos de ISA | ✔ **Corregido** | ISA explained GB v3: los 19 aceptados son de finanzas UK; religión, ejército y otros idiomas, fuera con su motivo |
| F-02 · first time buyer | ✔ en términos | Coches fuera y «First-Time Homebuyer», «I Bought a House in the UK…» aceptados. Pero ver P1-04 y P3-01 |
| F-04 · hashtags y español frente a portugués | ✔ casi | datos curiosos ES: 49/50 aceptados, `#datoscuriosos` cuenta. 1 falso negativo: «3 DATOS DE DINOSAURIOS QUE NO SABÍAS!!!» detectado como `pt` (P3-02) |
| F-07 · análisis de motor anterior | ✔ | Descubrir: «Análisis de una versión anterior del motor (3)»; Guardadas: «Guardado con una versión anterior del motor…» |
| Numeración de pasos | ✔ | 1·2·3·4 en todas las pestañas |
| Miniaturas y monetización «muy baja» | ✔ parcial | Las cifras prestadas aparecen como «muy baja». Siguen los rangos degenerados (P3-03) |
| Avisos por sección | No comprobado a fondo | El aviso «Resultados actualizados» aparece tras buscar; no vi que se quedara al cambiar de pestaña |
| F-03 · anuncios | No probado en real | Requiere un tema con anuncios; queda pendiente |
| F-05 · ventana de oferta | ✔ aparente | ETF DE: 6,3/semana, coherente. FTB: «168 vídeos nuevos por semana» sale de 24 vídeos en ~1 día (ver P2-07) |

## 2. Problemas abiertos (ordenados por gravedad)

### P1-03 · Falsos negativos masivos en alemán (y en cualquier idioma que no sea inglés) con términos ambiguos

- **Pantalla:** Nichos → tarjeta → «Muestra: 49 vídeos examinados (16 aceptados · 19 dudosos · 14 descartados)».
- **Acción:** analizar «ETF Sparplan erklärt» · Alemania.
- **Obtenido:** 19 vídeos que sí son del tema quedan «dudoso · contexto» con el mensaje «nada en el título… confirma que «ETF» sea fondo cotizado». Ejemplos:
  - «ETF-Sparplan für Anfänger»
  - «ING ETF kaufen / ETF Sparplan anlegen»
  - «Die besten ETF-Sparpläne der Schweiz»
  - «ETF-Sparplan einrichten: Schritt für Schritt»

  Otros 14 se descartan por «tema» al 50 %, por ejemplo «Welcher ETF ist der Beste?» y «Was passiert im WORST CASE mit deinem MSCI World ETF».

  Consecuencias:
  - la demanda se calcula con 16 vídeos;
  - la confianza queda «baja»;
  - el crecimiento sale «No calculable» porque las ventanas se vacían.
- **Esperado:** se aceptan, porque «Sparplan», «Aktien», «Börse», «MSCI» o «investierst» confirman el sentido financiero. Con un tema de dos términos, el **segundo término** ya desambigua.
- **Reproducción sin cuota** sobre `58808ed`: `assessVideo(v, queryProfile('ETF Sparplan erklärt'), ['de'])` con esos títulos da `dudoso/contexto` en todos; los dos de una sola palabra dan `descartado/tema 50 %`. Mismo resultado en `46fbf89`, así que no se ha tocado.
- **Causa:** la lista `words` del sentido `etf/finanzas` (`relevance.ts:83-84`) está solo en inglés y no considera los demás términos de la consulta.
- **Propuesta:**
  1. Si otro término de la consulta pertenece al nicho del sentido buscado (Sparplan, Depot, Rente, ahorro…), cuenta como confirmación.
  2. Añadir vocabulario por idioma: `de` (Aktien, Börse, Depot, Sparplan, Rendite, Dividende, Fonds, anlegen, investieren, MSCI, Vermögen); `es` (acciones, bolsa, fondo indexado, invertir, cartera); `fr` (bourse, actions, placement, PEA, investir).
  3. Para términos como «Welcher ETF ist der Beste?», aplicar a la cobertura la misma lógica de equivalencias que «first time buyer» (`PHRASES`): «ETF Sparplan» ≈ «ETF» + verbo de ahorro periódico.
- **Regresión:** los 7 títulos anteriores con `expected=['de']` → `aceptado` (los dos de una palabra, al menos `dudoso`, no `descartado`).
- **Afecta a:** DE (20), CH (20, solo alemán) y cualquier término ambiguo (ETF, ISA, Super, Säule…) fuera del inglés, es decir, **40 de las 120 combinaciones**.

### P1-04 · El país elegido no es el mercado medido, y la tarjeta no lo refleja

- **Pantalla:** Nichos → «Calidad de la muestra… Canales con país GB: 9 de 30 que declaran país».
- **Acción:** analizar «first time buyer» · Reino Unido.
- **Obtenido:** 41 de 50 aceptados, la mayoría norteamericanos:
  - «NEW FHA Loan Requirements 2026» y «How Do First-Time Buyers in Virginia Find Down Payment Help?» (×3 variantes);
  - «First-Time Buyer Programs 2026 — Ontario Edition» y «25 vs 30-Year Mortgage in Canada»;
  - «Lennar's Courtland… (MN)», «Denton deal #dentontexas» y uno de «#DubaiRealEstate».

  La demanda (73) y la oferta (97, «168 vídeos nuevos por semana») se presentan como del Reino Unido. Lo mismo pasa en «datos curiosos» · España: 4 de 40 canales con país ES.
- **Esperado:** que la tarjeta avise de forma visible, no en una frase técnica: «La mayor parte de esta muestra parece de otros países (EE. UU., Canadá): la demanda no es del Reino Unido». Y que la confianza baje, o que se pueda filtrar por país declarado del canal.
- **Propuesta:**
  1. Señales de mercado (país del canal, moneda £/$/€, topónimos, programas como FHA/Help to Buy/FHSA): marcar «otro mercado» y sacar esos vídeos de la demanda del país, como ya se hace con los anuncios.
  2. Si menos del 50 % de los canales con país declarado son del mercado, bajar la confianza a «baja» y mostrarlo en la cabecera.
  3. Para los temas genéricos en inglés, sugerir añadir el país al tema («first time buyer UK»).
- **Regresión:** FTB GB con los títulos de Virginia, Tennessee, FHA y Ontario → fuera de la demanda GB.
- **Afecta a:** US, AU, UK y CA comparten idioma (80 combinaciones); CH y DE comparten el alemán.

### P2-01 · Las «unidades» no se explican en ningún sitio (Fase 2)

Lo que ve un usuario: «Aplicar y buscar (204 unidades)», «Medir crecimiento (+102 unidades)», «X de 6000 unidades… y Y de sus 60 búsquedas».

**Falta decir:**
1. qué es una unidad;
2. que no cuesta dinero;
3. que se renueva a las 00:00 hora del Pacífico (09:00 en España o los Países Bajos en verano y 08:00 en invierno);
4. qué pasa al agotarse.

**Además**, la cifra de unidades no coincide con la de Google Cloud. Google mostraba **46 «Queries per day»** cuando la app sumaba 918 unidades ese día. El límite que manda es el de **búsquedas: 23/100** en Google frente a 9/60 en la app, porque la app no ve las búsquedas de antes del despliegue ni las de otras herramientas.

**Texto propuesto**, en un «¿Qué es esto?» junto al contador:
> «Cada análisis hace 2 búsquedas en YouTube (unos 204 puntos de la cuota diaria de YouTube). No es un pago: es el límite de uso gratuito que YouTube da a este proyecto. Se renueva cada día a las 09:00 (hora de España). El límite que se agota antes son las búsquedas: 100 al día para todo el proyecto, y esta app se reserva 60. Si se acaban, los análisis ya hechos siguen visibles y podrás seguir mañana. Las cifras son una estimación de esta app; la cifra oficial está en Google Cloud.»

**En el botón:** «Analizar (2 búsquedas de 60 hoy)», no «204 unidades». Hoy la búsqueda es lo que limita.

### P2-02 · Restos de lenguaje técnico o engañoso

- Guardadas dice: «Los análisis **de pago** se conservan…». No hay pago. Propuesta: «Los análisis ya hechos se conservan…» (`tab-saved.tsx:54`).
- Guardadas muestra «GB · en · **discovered**», el estado interno sin traducir (`tab-saved.tsx:27` y su render). Propuesta: «Reino Unido · inglés · Nueva».
- En cada pestaña aparece: «el contador está solo en memoria (**falta la migración research_cache**)». Propuesta: «Este contador se guarda solo en este navegador», y nada de migraciones.
- El plan guiado dice: «Coste total… **YouTube concede 10.000 al día** a todo el proyecto» (`guided-panel.tsx:49`). Calla que manda el límite de 100 búsquedas: 20 análisis son 40 búsquedas. Propuesta: «20 análisis = 40 búsquedas. El proyecto tiene 100 búsquedas al día (esta app usa como máximo 60): este plan necesita N días».

### P2-03 · «Medir crecimiento» sigue disponible tras medir

Después de medir, la tarjeta muestra el resultado y el mismo botón «Medir crecimiento (+102 unidades)». Un usuario volverá a pulsar.

- **Propuesta:** sustituirlo por «Crecimiento medido el 16 oct» y, como mucho, «Volver a medir (puede costar 1 búsqueda)».
- No lo pulsé otra vez, para no gastar.

### P2-04 · Filtros: el mismo panel mezcla filtros que buscan y filtros que solo ordenan

Esto sigue igual que en `46fbf89`; el detalle está en `matriz-controles-investigacion.csv`.

- **País e Idioma** lanzan consultas nuevas. **Nichos, umbrales, RPM, formato y confianza** solo filtran lo guardado. Todos aparecen juntos y con la misma apariencia.
- Si se quita el chip de país, el botón principal se convierte en una búsqueda de pago «Mundial».
- Conviven «Aplicar y mostrar (en caché)» y «Solo aplicar filtros», que hacen lo mismo cuando todo está en caché.
- «Por defecto (30 días)» y «Últimos 30 días» son la misma opción. Con «Última semana», los análisis de 30 días siguen visibles sin aviso.
- El filtro «Nichos» no ayuda a desambiguar el tema.
- «Shorts (inferido)» y «Cortos (1–4 min)» se solapan.
- **Propuesta:**
  1. Dos bloques: «① Qué buscar en YouTube (gasta búsquedas)» con tema, país e idioma; y «② Filtrar lo que ya tienes (gratis)» con todo lo demás, plegado por defecto.
  2. Un único botón por bloque: «Analizar» y «Filtrar».

### P2-05 · Un usuario nuevo no sabe qué hacer al entrar

- La primera pantalla son unos 55 controles de filtro antes de ver ningún resultado. Descubrir pide «lanzar análisis» sin decir cómo.
- **Propuesta:** un estado inicial con un único campo («¿Sobre qué tema quieres hacer vídeos?») y un país. Debajo, el coste en lenguaje llano. Los filtros, plegados.

### P2-06 · «¿Por qué me recomienda este nicho?» solo se responde a medias

- Hay buena base: «Qué tan firme es y cómo se calcula», el inspector con aceptados, dudosos y descartados, el motivo de cada uno y la confianza.
- Falta un resumen en una frase que combine las pruebas, por ejemplo: «Te lo sugerimos porque 41 vídeos del tema ganan una mediana de 1.806 vistas/día, pero hay 23 canales publicando y la mayoría de la muestra no es de Reino Unido: confianza baja».
- Las chips de «Evidencia» muestran palabras sin valor: «time · 41», «first time · 40».

### P2-07 · La oferta extrapolada desde una ventana de un día

- FTB GB muestra «168 vídeos nuevos por semana» porque los 24 recientes caben en ~1 día. Es correcto como ritmo, pero se lee como un dato medido.
- **Propuesta:** «≈ 24 vídeos en las últimas 24 h (ritmo de ~168/semana)», y nota de que la muestra no llega a cubrir 30 días.

### P3

- **P3-01.** «$800K Gets you THIS in New York City? | First Time Buyer Reacts» se descarta por «nicho: animales». Los casi idénticos de $300K y $400K se aceptan.
- **P3-02.** «3 DATOS DE DINOSAURIOS QUE NO SABÍAS!!!» se detecta como portugués.
- **P3-03.** Rangos degenerados: «$10,22–$10,22», «$2,98–$2,98», «$2,05–$2,05». Mostrar «≈ $10,22 (sin rango)».
- **P3-04.** ISA: «The ISA-95 Stack…» e «Instrument Tag Letters (ISA 5.1)» salen como «videojuegos (palabras: level)». La exclusión es correcta, pero el motivo debería ser «industria o automatización». «Isa-Isa» en tagalo aparece como `pl`.
- **P3-05.** El coste previsto solo habla de unidades: «1 análisis nuevo × 204 = 204 unidades». Debería decir también «2 búsquedas».
- **P3-06.** «2 oportunidad(es) en el workspace»: usar plural real y evitar «workspace».

## 3. Persistencia (Fase 8)

| Prueba | Resultado |
|---|---|
| Recargar (×5) | Se mantienen análisis, contador, pestaña, filtros y tema ✔ |
| Medir crecimiento tras recargar | ✔ (el navegador envía su análisis) |
| Análisis de versión anterior | Se separan y se avisa; no cuentan en recomendaciones ✔ |
| Favoritos | Persisten ✔ |
| Otro dispositivo o navegador | **No funciona sin `research_cache`**: análisis y contador viven en `localStorage` |

**Qué depende de `research_cache`** (sin aplicar):
- caché compartida entre dispositivos e instancias, para no repetir búsquedas;
- contador del servidor común a todos los navegadores (hoy cada navegador cuenta lo suyo);
- reserva atómica real (hoy en memoria por instancia).

**Funciona sin ella:** todo lo demás dentro de un mismo navegador.

## 4. Cuota y pruebas reales de esta ronda

| # | Prueba | Resultado | Coste (app) |
|---|---|---|---|
| 1 | Medir crecimiento · ETF Sparplan · DE | Funciona; «No calculable» con motivo claro | 102 u · 1 búsqueda |
| 2 | first time buyer · GB | Coches fuera ✔; mercado contaminado ✘ (P1-04) | 204 u · 2 |
| 3 | datos curiosos · ES | Hashtags ✔, 49/50; 1 falso «pt»; 4/40 canales ES | 204 u · 2 |
| 4 | ISA explained · GB | Homónimos fuera ✔, 19/19 aceptados de finanzas | 204 u · 2 |
| — | Anterior (hoy): ETF Sparplan erklärt · DE | P1-03 (ya en motor v3) | 204 u · 2 |

**Google Cloud (proyecto `cerebro-studio-509818`) al terminar:**

| Cuota | Uso | Límite | % |
|---|---|---|---|
| Search Queries per day | 23 | 100 | 23 % |
| Queries per day | 46 | 10.000 | 0,46 % |
| Search Queries per minute | 1,3 | 100 | — |

Margen real hoy: 77 búsquedas, unos 38 análisis. La app permite 51 más por su tope de 60, así que no se pasa del límite real.

**No he probado:**
- anuncios (F-03), porque requiere elegir un tema con anuncios;
- la cuota agotada en real, que solo se puede simular;
- la concurrencia entre instancias, que está prohibida.

## 5. Estado de las 120 combinaciones

Ver `matriz-120-analisis.csv`:

| Estado | Combinaciones |
|---|---|
| validado (relevancia; oferta y crecimiento sin contrastar) | 1 (ISA UK) |
| NO validado · P1-03 alemán | 1 (ETF Sparplan DE) |
| NO validado · P1-04 mercado | 1 (first time buyer UK) |
| obsoleto (motor anterior): repetir con v3 | 26 |
| pendiente (bloqueado por P1-03 y P1-04) | 91 |

**Configuración que falta:**
- Canadá solo en inglés: falta Quebec en francés.
- Suiza solo en alemán: faltan francés e italiano.

**Plan cuando se corrijan P1-03 y P1-04:**
1. Muestra de 8 análisis: 16 búsquedas.
   - 2 en DE: ETF Sparplan y Säule 3a en CH.
   - 2 ambiguos en inglés: Super AU e ISA UK.
   - 2 genéricos sin país en el tema: first time buyer, index funds.
   - 1 saturado.
   - 1 de CA en francés.
2. Validar a mano cada inspector.
3. Lotes de 10 por día (20 búsquedas), comprobando Google Cloud antes de cada lote.

En total son 120 análisis y 240 búsquedas, unos 4–5 días con el tope de 60/día.

## 6. Recorrido propuesto (Fase 7)

1. **Elegir qué investigar:** un campo «¿Sobre qué tema?» más un país.
2. **Filtros comprensibles:** plegados, separados en «buscar» y «filtrar lo que ya tienes».
3. **Coste:** «Gastará 2 de tus 60 búsquedas de hoy · no es un pago», con «¿Qué es esto?».
4. **Ejecutar:** botón «Analizar».
5. **Comprender:** una frase «Por qué», tres cifras y la confianza en la cabecera; detalles plegados.
6. **Comparar:** la tabla ya existe; añadir una columna «% de la muestra del país».
7. **Guardar:** existe ✔.
8. **Continuar:** «Planificar campaña» existe ✔ (moneda GBP para Reino Unido, según Code; no lo he revalidado en esta ronda).

## 7. Pruebas de regresión que añadir

1. Los 7 títulos alemanes de P1-03 → aceptados o, como mucho, dudosos.
2. FTB GB: los títulos de Virginia, Tennessee, FHA y Ontario → fuera de la demanda del Reino Unido.
3. «$800K Gets you THIS in New York City? | First Time Buyer Reacts» → no «animales».
4. «3 DATOS DE DINOSAURIOS QUE NO SABÍAS!!!» → `es`.
5. Ningún texto visible contiene «de pago», «discovered», «migración» ni «10.000 al día» (prueba de UI).
6. Tras «Medir crecimiento», el botón cambia de texto.

## 8. Entrega a Claude Code

Code indica en `docs/auditoria-46fbf89-resoluciones.md` que **no recibió** `0001-auditoria-navegador-46fbf89.patch`. Esta sesión no puede subir al repositorio: `gh api` y push devuelven 403.

Por eso se entrega un paquete manual:
- `0001-auditoria-navegador-58808ed.patch`, aplicable sobre `58808ed`. Añade `docs/auditoria-navegador/` con este informe, las dos matrices y las capturas.

Hay que subirlo o pegarlo a mano. **No está compartido automáticamente.**
