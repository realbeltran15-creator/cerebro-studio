# Instrucciones para Claude Code · validación real sobre `d5c44fc` (motor v4) · 17-10-2026

Pruebas reales hechas desde la interfaz:
- ETF Sparplan erklärt (Alemania)
- first time buyer (Reino Unido)
- first time buyer (Estados Unidos)
- 1 medición de crecimiento

Consumo: 7 búsquedas y 714 unidades. Google Cloud marca «Search Queries per day» 7/100, igual que la app.

## E-1 (P1) · El crecimiento sale casi siempre «al alza» por cómo se calcula

**Qué pasa.** En ETF Sparplan DE el resultado fue «al alza (posible), ×10». Los datos son:
- `recent` (13 vídeos): mediana de 10 vistas/día;
- `previous` (19 vídeos): mediana de 1 vista/día.

**Causa** (`lib/research/topic-analysis.ts`, funciones `cohort` y `growthFrom`):
- `viewsPerDay` se calcula como vistas totales ÷ edad del vídeo.
- La mayoría de los vídeos reciben casi todas sus vistas en los primeros días y luego se estancan.
- Por eso un vídeo de 15 días da unas 3 veces más vistas/día que uno de 45 días con las mismas vistas totales.
- El umbral actual (×2) es menor que ese efecto de la edad, así que un tema estable sale «al alza».
- El comentario del código («los más antiguos tuvieron más tiempo para acumular vistas») razona al revés para vistas/día.
- Además, una mediana de 1 frente a 10 vistas/día es ruido, no tendencia.

**Corrección:**
1. Comparar la mediana de **vistas totales** de los vídeos de cada ventana. En vídeos ya estancados, esto favorece algo a la ventana anterior, así que es un sesgo conservador.
2. O bien dividir el ratio entre (mediana de edad de `previous` ÷ mediana de edad de `recent`) antes de aplicar los umbrales.
3. Añadir un mínimo absoluto: si alguna mediana es menor de 50 vistas/día (o de 1.000 vistas totales), el resultado es «estable o no concluyente».
4. Corregir el texto explicativo.

**Prueba de regresión.** Dos cohortes con las mismas vistas totales y edades de 15 y 45 días deben dar «estable o no concluyente», no «al alza».

## E-2 (P1) · «first time buyer» en EE. UU.: vídeos de compra de vivienda marcados como dudosos

**Qué pasa.** Solo 10 de 50 vídeos cuentan y la confianza es baja. Estos vídeos son claramente de compra de vivienda en EE. UU. y quedan como «dudoso · contexto (el tema es de finanzas y nada en el vídeo lo confirma)»:
- «America's typical first-time home buyer is now 40»
- «First-time homebuyers are now 40. Is the American dream out of reach?»
- «HGTV vs. REALITY: Home Buying Budgets & First-Timers»
- «$400K / $300K Gets You THIS in Manhattan? First-Time Buyer Reacts»
- «This 1 Number Runs the Jacksonville Market | First-Time Buyers»
- «The Magical Home Buying Method for Immigrants and First-Time Buyers»

En Reino Unido pasa lo mismo con «Both votes SNP - Up to £10,000 to help first-time buyers».

Lo he reproducido sin gastar cuota llamando a `assessVideo(v, queryProfile('first time buyer'), ['en'], { strict: true, region: 'US' })`: los 8 dan `dudoso`.

**Causa.** En modo estricto (`relevance.ts:301`), `nicheEvidence` vuelve a clasificar el texto **sin las palabras de la consulta** y exige el nicho `finanzas`. Pero la lista de `finanzas` en `lib/research/taxonomy.ts:15` no incluye vocabulario de vivienda.

**Corrección.** Añadir a `finanzas` (o crear un nicho «vivienda» compatible con `finanzas` en `NEIGHBOURS`):
- home buyer, homebuyer, homebuyers, home buying, buying a home, buy a house, homeowner, homeownership
- real estate, realtor, housing market, house prices, down payment, closing costs, pre-approved
- condo, apartment, starter home, property market, deposit
- una cifra con £, $ o € seguida de K (por ejemplo, «$400K», «£315K»)

**Prueba de regresión.** Los 8 títulos anteriores deben salir `aceptado` en US (o `dudoso` por **otro país** si son de UK o Canadá). «Best first car to buy for new car buyers», «First Time Patek Philippe Buyer?» y «OneFunded… First-Time Buyers Get 20% OFF» deben seguir fuera o dudosos.

## E-3 (P3) · Restos de texto

- La tarjeta de crecimiento ya medido dice «Gratis · ya medido el **,17 oct**»: sobra la coma (falta la fecha completa o el formato está mal).
- El plan guiado aún dice «YouTube concede 10.000 al día a todo el proyecto» (`guided-panel.tsx:49`). Debe mencionar el límite de 100 búsquedas al día (40 búsquedas para 20 análisis).
- El coste previsto solo habla de unidades («1 análisis nuevo × 204 = 204 unidades»). Debe añadir «2 búsquedas».
- «$800K Gets you THIS in New York City? | First Time Buyer Reacts» se descarta con el motivo «nicho: animales». Revisar la palabra que lo activa en `taxonomy.ts`.
