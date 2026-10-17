# Auditoría real de `58808ed`: resoluciones y batería de validación

Rama `feat/creation-studio`. Todo se probó con datos SIMULADOS (fixtures basados en la auditoría); no se ha lanzado ninguna búsqueda a YouTube, no se ha aplicado ninguna migración y no se ha tocado Producción. **Que los fixtures pasen no valida el comportamiento real con YouTube**: eso lo comprueba la batería del final.

`0001-auditoria-navegador-58808ed.patch`: no está disponible en esta conversación ni en el repositorio. No se ha aplicado ni se da por recibido; los problemas se han corregido a partir de la descripción.

## 1. Relevancia multilingüe («ETF Sparplan erklärt»)
**Causa.** (a) Las pistas que confirman que «ETF» es un fondo cotizado eran solo inglesas (`stocks`, `invest`, `portfolio`…): un vídeo alemán quedaba «dudoso» por falta de pruebas. (b) La cobertura exigía las dos palabras de la consulta: «Welcher ETF ist der beste?» no dice «Sparplan» y se descartaba. (c) No se entendían compuestos (`Vermögensaufbau`, `Weltportfolio`), `ß`, ni `ue/oe/ae`, ni sinónimos (`Indexfonds` = ETF).

**Corrección.**
- `lib/research/lexicon.ts`: vocabulario financiero **escrito en cada idioma** (alemán, español, francés, italiano, neerlandés, portugués), no traducido palabra por palabra. Las pistas solo cuentan si el vídeo está en ese idioma (así `depot` o `bank` en un título inglés no confirman nada). El alemán busca además raíces dentro de palabras largas (`…portfolio…`, `…vermögen…`).
- `fold` convierte `ß` en `ss`; sinónimos del término (ETF ↔ Indexfonds / index fund / fondo indexado…; Sparplan ↔ Sparrate / plan de ahorro / piano di accumulo…).
- **Crédito de dominio**: un vídeo que nombra el término ambiguo (o los específicos) y tiene pistas de dominio en su idioma, **sin ninguna pista de otro significado**, cubre las demás palabras a la mitad. Así «Welcher ETF ist der beste?» entra y «ETF Fortnite Clan» no.
- El inglés no se afloja: las listas son por idioma y los significados rivales (juegos, música, religión, militar) siguen vetando. ISA conserva su corrección.

**Pruebas** (simuladas): `tests/research-multilingual.test.ts` — 14 vídeos alemanes válidos, variantes `ue/oe/ß`, español/francés/italiano/neerlandés, vídeos alemanes no financieros, casos ambiguos («ETF erklärt» sin contexto → dudoso/descartado, nunca contado), inglés intacto y la muestra de 25 resultados (21 válidos aceptados, 4 apartados).

## 2. Fiabilidad de los mercados («first time buyer» en Reino Unido)
Cuatro cosas distintas que antes se mezclaban (`lib/research/geo.ts`):

| Qué | De dónde sale | Se usa para |
|---|---|---|
| País **pedido** | el parámetro de la búsqueda | solo orienta el ranking de YouTube |
| País **declarado del canal** | ajustes del canal (opcional, a menudo vacío) | solo cuenta como pista a media ponderación; **nunca** excluye un vídeo |
| País del **contenido** | el propio texto del vídeo (leyes, impuestos, productos, instituciones, moneda: `FHA loan`, `401k`, `FHSA`, `Help to Buy`, `Säule 3a`…) | un vídeo cuyo contenido es de **otro** país se aparta como «dudoso» con el motivo («habla de EE. UU. (fha loan…)») |
| País de los **espectadores** | no existe en la API pública | siempre «no se puede saber» |

Cada análisis lleva un resumen geográfico: pistas del canal, pistas del contenido, vídeos apartados, **confianza geográfica** (`media` como máximo, nunca «alta» ni «verificada»; `baja`; `contradictoria` si la mayoría de las pistas apuntan a otros países; `insuficiente`) y una frase honesta: «Investigación orientada a Reino Unido…». Si es contradictoria, la confianza del análisis baja a «baja» (no puede salir «oportunidad») y la tarjeta dice que **no es demanda del mercado pedido**. Las comparaciones entre países marcan como no comparable un mercado cuyos resultados son de otro país, y los huecos entre países no se emiten en ese caso. El CSV incluye la columna `confianza_geografica`, y la pantalla explica las cuatro cosas y sus límites.

**Pruebas** (simuladas): `tests/research-geo.test.ts` (17).

## 3. Claridad para usuarios nuevos
- **Unidades de cuota** en lenguaje sencillo («¿Qué son las unidades de YouTube?»): no son dinero, cuánto gasta cada acción, que existe un segundo límite de búsquedas, qué pasa al agotarse (se reinicia a medianoche del Pacífico; ampliarlo hay que pedírselo a Google), que esta aplicación no cobra por unidad ni usa IA de pago en Investigación.
- **Gratis frente a gasta cuota**: leyenda y etiquetas en cada bloque del panel (países/idiomas/temas/periodo = gasta cuota; nichos, formatos, tipos, RPM, resultado del análisis y filtros avanzados = gratis).
- **Textos técnicos sustituidos**: «discovered» → «Descubierta» (y los demás estados), «análisis de pago» → «análisis que ya has hecho», «en caché» → «ya guardado, gratis», país/idioma/fuente/confianza en español, sin nombres de migraciones ni de tablas.
- **«Medir crecimiento»**: indica si ya hay una medición vigente (con su fecha y resultado) o si se midió sin resultado y por qué; en ambos casos **no ofrece el botón** y el cliente no llama; si caducó, lo dice y permite repetir.

**Pruebas**: `tests/ui-clarity.test.ts` (10) y comprobaciones de navegador (simulado).

## Errores pendientes / límites
- Validación con datos reales de YouTube: pendiente (batería abajo).
- Las pistas geográficas son listas escritas a mano (12 países); un vídeo sin pistas puede ser de cualquier país. El país del canal es opcional y a menudo falta.
- El vocabulario multilingüe cubre finanzas e inversión; otros temas en alemán dependen de la cobertura por palabras de la consulta.
- `research_cache` sigue sin aplicarse (la coordinación entre instancias y el contador compartido necesitan tu autorización).
- La versión del motor sube a 4: los análisis de la 3 se conservan aparte y hay que repetirlos para que entren en recomendaciones.

## Batería para Claude Chat (Preview; 3 análisis + 1 medición ≈ 714 unidades y 7 búsquedas)
No lances nada más. Anota para cada caso el commit de la Preview.

1. **«ETF Sparplan erklärt», mercado Alemania, idioma alemán** (≈ 204 u, 2 búsquedas). Abre «Muestra». Esperado: la mayoría de los vídeos alemanes sobre ETF/Sparplan/Indexfonds aparecen **Aceptados** (idealmente ≥ 70 % de los relevantes); los descartados son de verdad ajenos (juegos, cocina, música, otro idioma); ningún inglés aceptado; «Dudosos» solo si falta contexto. Anota cuántos aceptados cree que sobran o faltan.
2. **«first time buyer», mercado Reino Unido, idioma inglés** (≈ 204 u). Esperado: aparece la línea de **confianza geográfica** y la sección «De qué país es lo que ves»; vídeos con `FHA`, `401k`, `FHSA`, `RRSP`… en «Dudosos: habla de EE. UU./Canadá»; si la mayoría de las pistas son de EE. UU./Canadá, el análisis dice «contradictoria» y **no** es «oportunidad». Comprueba a mano 5 vídeos del top: ¿su contenido es británico?
3. **Control: «first time buyer», mercado Estados Unidos** (≈ 204 u). Esperado: confianza geográfica no peor que en el caso 2 y sin vídeos apartados por «habla de EE. UU.».
4. **Medir crecimiento** sobre el caso 1 (+102 u, 1 búsqueda): el botón indica el coste; tras medir, desaparece y muestra «ya medido el …» o «sin resultado» con el motivo; recargar la página y comprobar que **no** vuelve a ofrecerse ni consume cuota.
5. **Sin gasto**: panel de filtros con «Gratis» / «Gasta cuota» y el desplegable de unidades; estados de oportunidades en español; sin textos «discovered», «análisis de pago» ni migraciones; análisis antiguos (motor 3) en «versión anterior del motor».
6. Comparar el consumo del indicador (unidades y búsquedas) con la consola de Google Cloud al terminar y anotar la diferencia.
