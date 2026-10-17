# Prueba real · «AI tools for beginners» · Estados Unidos · inglés · 30 días · `c2b9275` (motor v5) · 17-10-2026

## Comprobaciones previas

- **Sesión de Vercel activa.** Hice una petición gratuita a `GET /api/research/topic?...&cacheOnly=1` con `redirect:'manual'`: respondió `200`, tipo `basic`, sin redirección. No había nada en caché (`analysis: null`).
- **Coste anunciado en pantalla:** «Se buscará: 1 tema × 1 mercado (Estados Unidos (inglés))». El botón decía «Aplicar y buscar (204 unidades · 2 búsquedas)».
- **Google Cloud antes** (16:40 UTC): Search Queries per day **7/100**, Queries per day **19/10.000**.
- **Contador de la app antes:** 714 unidades y 7 búsquedas.

## Ejecución (una sola vez)

- Hubo una única llamada `GET /api/research/topic?q=AI+tools+for+beginners&days=30&region=US&lang=en`, que respondió **200 en 2,36 s**.
- No apareció ningún «Failed to fetch» ni ningún error en pantalla.
- **Contador de la app después:** 918 unidades y 9 búsquedas, es decir, **+204 y +2**, igual que lo anunciado.
- El análisis guardado tiene `engineVersion` 5, `units` 204 y `fetchedAt` 2026-10-17T16:41:59Z.

## Qué devolvió

- **49 vídeos examinados.** De ellos:
  - 22 cuentan;
  - 20 se descartan por tema, 3 por nicho y 3 por idioma (hindi);
  - 1 queda como dudoso.
- **Canales con datos reales:** Dan Martell (3,12 M), Ayushman Pandita (1,04 M), Raj Shamani (19,9 M), etc. Cada vídeo aparece con sus vistas, la fecha, las vistas/día y el país que declara el canal.
- **Métricas:**
  - Demanda 88; oferta 86 («112 vídeos nuevos por semana, 16 canales distintos entre 16 recientes»); competencia 87 (canal mediano de 2,1 M); oportunidad 51.
  - Veredicto **Saturado** con confianza **baja**.
  - Crecimiento «No calculable», con el motivo explicado.
- **Mercado:** «Pistas geográficas contradictorias… apuntan a IN, PK y KE: estos resultados NO se pueden presentar como demanda de EE. UU.». De los 17 canales que declaran país, solo 2 son de EE. UU. Correcto y honesto.
- **Concentración:** un solo vídeo, un Short de 17 s de Dan Martell con 10,2 M de vistas, reúne el **56 %** de las vistas. La app lo señala en la confianza y en «demandProfile: insuficiente».

**Conclusión: la búsqueda funciona de punta a punta en la Preview.** Antes había comprobado que el «Failed to fetch» lo provoca la protección de Vercel cuando falta la sesión, no el código del análisis.

## Errores de calidad (sin gastar más cuota)

### Q-1 (P1) · Ingresos estimados inflados: la prima de EE. UU. se cuenta dos veces y se aplica aunque el mercado sea «contradictorio»

**Evidencia:** «Full Claude Tutorial for Beginners» (Ayushman Pandita, canal IN, 1.817.583 vistas) aparece con **$13.959 – $87.244 (central $50.602)**. Eso es un RPM de **$7,7–$48 por 1.000 vistas**.

**Causa** (`lib/research/revenue.ts`, `estimateRevenue` / `videoRevenue`):
- El RPM del nicho `ia` es 4–25, heredado de `tecnologia` (`monetization.ts:33-34`). Su nota ya dice que «15–25 USD es con audiencia de EE. UU.».
- Encima se multiplica por `marketFactor('US')` ≈ **×1,92**: 7,68 ÷ 4 = 1,92.
- Resultado: la prima de EE. UU. se aplica **dos veces**.
- Además se aplica aunque `analysis.geo.level === 'contradictoria'` (solo el 12 % de las pistas son de EE. UU.).

**Corrección:**
1. No aplicar `marketFactor` cuando el rango del nicho ya está expresado para EE. UU. o para una audiencia mixta. Añadir un campo `audience: 'us' | 'mixed' | 'global'` en `monetization.ts` y ajustar solo los rangos globales.
2. No aplicar ningún ajuste de mercado cuando `geo.level` sea `contradictoria` o `baja`, y decirlo en `assumptions`.

**Prueba de regresión:** 1.817.583 vistas, nicho `ia`, formato largo, región US y geo contradictoria → RPM máximo ≤ $25 por 1.000. Y nunca un vídeo de 1,8 M de vistas por encima del doble del de 10 M sin explicarlo.

### Q-2 (P2) · Falsos negativos por tomar «tools» literalmente

Términos de la consulta: `ai`, `tools`. Se descartan al 50 % («solo muestra 50 % de los términos»):
- «FULL Claude Tutorial for Beginners in 2026!»
- «The Ultimate Beginner's Guide to Claude AI»
- «Google AI Studio Tutorial for Beginners 2026»
- «Free AI COURSE for Beginners»

Pero «Full Claude Tutorial for Beginners - Become A Pro…» se **acepta**: los títulos son casi iguales y el resultado se contradice.

Un tutorial de Claude, ChatGPT, Gemini, Copilot o Midjourney es un tutorial de una herramienta de IA.

**Corrección:** en `relevance.ts` → `SYNONYMS` o `PHRASES`, hacer que los nombres de herramientas de IA (chatgpt, claude, gemini, copilot, midjourney, perplexity, notebooklm, ai studio, canva ai, cursor) cuenten como el término `tools` cuando la consulta contiene `ai` + `tools`.

**Prueba de regresión:** los 4 títulos anteriores → aceptados.

### Q-3 (P3) · La demanda la domina un Short

La demanda de 88 se apoya en solo 6 vídeos relevantes del top. Uno es un Short de 17 s con 10,2 M de vistas, que es el 56 % de la muestra.

La app lo avisa, pero «Demanda 88/100» en grande transmite más seguridad de la que hay.

**Propuesta:** cuando `concentration.top1 ≥ 0,5`, mostrar la demanda como «88 (dominada por 1 vídeo)» o calcularla también sin ese vídeo.

### Q-4 (P3) · Las muestras recientes tienen vistas casi nulas

Hay vídeos recientes aceptados con 1–28 vistas, Shorts publicados hace horas. Son correctos como «oferta», pero inflan «112 vídeos nuevos por semana» con contenido sin tracción.

**Propuesta:** indicar cuántos de los recientes superan, por ejemplo, 100 vistas.

## Consumo frente a Google Cloud

- **App:** +204 unidades y +2 búsquedas (de 7 a 9).
- **Google Cloud a las 17:02 UTC:**
  - Search Queries per day **9/100** (+2): coincide exactamente con la app.
  - Queries per day **23/10.000** (+4): 2 búsquedas más las llamadas de detalle de vídeos y canales. Google cuenta peticiones, no las 204 «unidades».
  - La consola tardó unos 15–20 minutos en reflejar el consumo: a las 16:43 seguía en 7.
