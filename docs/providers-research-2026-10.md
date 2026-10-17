# Proveedores de imagen, vídeo y audio: investigación del 2026-10-10

Qué se investigó, qué se probó de verdad y qué no. **Nada de aquí se presenta como funcionando si no se ejecutó.**
Esta sesión no podía abrir las páginas oficiales (el proxy de la organización deniega esos dominios), así que las cifras vienen
del buscador y se etiquetan por su nivel de evidencia. El único servicio que sí se pudo llamar fue la API de Gemini.

## Niveles de evidencia (campo `evidence` del catálogo)

| Nivel | Significa |
|---|---|
| **Probado** | Una petición real al proveedor confirmó lo que se afirma (fecha en `evidenceNote`). |
| **Documentado** | La documentación oficial lo dice (leída vía buscador); no se llamó con una clave real. |
| **Fuente secundaria** | Solo blogs, agregadores o revendedores lo dicen. Es una pista, no un hecho. |
| **Sin verificar** | Implementado a partir de fragmentos de documentación; la forma exacta de la respuesta no está confirmada. **Las estrategias automáticas nunca lo eligen**: solo se usa si lo eliges tú. |

## Respuestas directas

1. **¿Hay vídeo de calidad gratis y renovable por API?** No. Lo único gratuito es **promocional**: la cuota de bienvenida de Alibaba Cloud Model Studio (Wan), ≈ 30–50 s durante 90 días, una sola vez. Los créditos "gratuitos" diarios/mensuales de Kling, Pika, Luma, Runway o Hailuo son de **su web/app**, no de su API.
2. **¿Y Google (Veo)?** Sin nivel gratuito en la API. **Comprobado en vivo**: con tu clave, Veo 3.1 Lite respondió 429.
3. **¿Nano Banana por API gratis?** No. **Comprobado en vivo**: los 5 modelos de imagen de tu clave (`gemini-2.5-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image`, `gemini-nano-banana-2.1`, `gemini-3-pro-image`) respondieron 429. El acceso gratuito de la app de Gemini no es una API gratuita.
4. **¿Qué imagen gratuita hay entonces?** Cloudflare Workers AI dentro de sus 10.000 neuronas diarias: **FLUX.2 klein 4B** (≈ 100 imágenes/día a 1344×768, hasta 4 referencias) es el modo gratis. FLUX.1 schnell queda como borrador.
5. **¿Y máxima calidad?** De pago: OpenAI GPT Image 2/1.5, Nano Banana Pro/2, FLUX.2 Pro (vía fal). Siempre con confirmación de coste.
6. **¿TopMediai por API con tu suscripción?** No: su propia FAQ dice que la API **no está incluida en los planes** y se compra aparte (la API de música "no se aplica al generador online"). Por eso hay un **importador de archivos** y no una conexión a tu cuenta.

## Pruebas en vivo con tu clave de Gemini (2026-10-10, sin gasto: todas devolvieron error o audio gratuito)

| Modelo | Resultado |
|---|---|
| `gemini-3.8-flash-tts` (voz) | **200 OK**, `audio/wav` — gratis |
| Texto (`gemini-3.8-flash`) | OK; `gemini-2.5-flash` ya no está disponible para cuentas nuevas (404) |
| 5 modelos de imagen (Nano Banana en todas sus versiones) | **429** `RESOURCE_EXHAUSTED` |
| `lyria-3-clip-preview`, `lyria-3.5` (música) | **429** |
| `veo-3.1-lite-generate-preview` (vídeo) | **429** (tras corregir un 400, ver abajo) |
| Búsqueda con *grounding* de Google | **429** |

Deducción razonable: la clave está en nivel gratuito sin facturación (de lo contrario Veo/imagen habrían funcionado). Una sola petición mínima por modelo; ninguna tuvo éxito de pago.

### Errores reales que salieron de las pruebas
- **Veo rechazaba toda petición**: el código enviaba `durationSeconds` como texto y la API exige un número (`INVALID_ARGUMENT`). Corregido; el test anterior daba por bueno el texto y ahora exige un número.
- **`gpt-image-1` se retira el 23-oct-2026** según una calculadora de terceros; el catálogo ya trae GPT Image 2 / 1.5 / mini y avisa en la tarjeta del antiguo.

## Vídeo: proveedor por proveedor

| Proveedor | API oficial | ¿Gratis por API? | Evidencia | Decisión |
|---|---|---|---|---|
| **Google Veo 3.1** (Lite/Fast/Standard) | Gemini API / Vertex | No (429 comprobado) | Probado | Integrado (de pago). Lite ≈ $0,05/s, Fast ≈ $0,10–0,15/s, Standard ≈ $0,40/s según terceros. |
| **Alibaba Wan** (Model Studio) | Sí, asíncrona | **Promocional**: 30 s (wan3.0) / 50 s (wan2.x) durante 90 días, nuevos usuarios, región Singapur. Los fallos no consumen cuota. Con cuenta verificada **cobra solo** al agotarla. | Documentado (cuota) / Sin verificar (endpoint) | Adaptador preparado, solo manual. Cerebro cuenta los segundos y **se niega a enviar** si su contador dice que se agotó. |
| **Kling** | Sí (paquetes de prepago) | No: los créditos diarios/mensuales son de la web y no dan acceso a la API | Secundaria | Solo vía fal.ai / Higgsfield (ya integrados). |
| **Pika** | Sin API propia confirmada; remite a fal.ai (≈ $0,20/5 s 720p) | No | Secundaria | Sin adaptador (no se pudo comprobar el esquema). |
| **Hugging Face** (Inference Providers) | Sí | **Mensual** pero minúsculo: $0,10 (gratis) / $2 (PRO) | Documentado | Sin adaptador: no alcanza ni para un clip. |
| **LTX-2 (Lightricks)** | Sí | No confirmado (prepago, mínimo $5) | Documentado | Sin adaptador. Pesos abiertos si algún día se aloja. |
| **MiniMax Hailuo** | Sí | No confirmado | Secundaria | Disponible vía Higgsfield (ya integrado). |
| **Z.ai CogVideoX** | Sí | CogVideoX-3 $0,20/vídeo; un "Flash" gratuito solo lo citan terceros y solo para China | Documentado / Secundaria | Sin adaptador. |
| **Pollinations** | Sí, sin clave | Límite por IP con cifras contradictorias | Secundaria | Descartado: sin SLA ni licencias claras. |
| **fal.ai** | Sí | No | — | Se mantiene como alternativa de pago; **nunca se envía sin tu confirmación del coste**. |

Veo, Wan y fal quedan integrados; el resto está en el directorio de Conectores como "solo investigado".

## Imágenes

| Modelo | Vía | Coste | Notas |
|---|---|---|---|
| **FLUX.2 klein 4B** | Cloudflare Workers AI | **Gratis** dentro de 10.000 neuronas/día (26,05 neuronas por tesela 512² de salida + 5,37 por referencia) | 4 pasos fijos, multipart, hasta 4 referencias ≤ 512×512 (Cerebro las reduce con `sharp`). **Modo gratis.** |
| FLUX.2 klein 9B | Cloudflare | ≈ $0,015/MP (≈ 1.360 neuronas): ~7 imágenes/día gratis | Cloudflare restringe algunos modelos pesados en plan Free (403/5035). Sin verificar → solo manual. |
| FLUX.1 schnell | Cloudflare | Gratis (≈ 96 neuronas) | Borrador. |
| **GPT Image 2 / 1.5 / mini** | OpenAI | ≈ $0,05–0,20 por imagen (terceros) | Referencias con `/images/edits` (`image[]`). Líder del ranking de Artificial Analysis según blogs. |
| **Nano Banana Pro / 2 / 2 Lite** | Gemini API | De pago (sin gratis comprobado) | Hasta 14 referencias (Pro). |
| FLUX.2 Pro, Nano Banana Pro, Ideogram 3 | fal.ai | De pago | Ya integrados. |

Los rankings de calidad salen de blogs que citan Artificial Analysis; no hay prueba propia de realismo de piel. **El estilo se decide con tus propios retratos de prueba**; el campo `quality` del catálogo es un juicio editorial.

## TopMediai: lo que está documentado

Fuente: docs.topmediai.com y páginas de producto (vía buscador).

| Capacidad | ¿API oficial? | Detalle | Estado en Cerebro |
|---|---|---|---|
| Texto a voz | Sí | `POST https://api.topmediai.com/v1/text2speech`, cabecera `x-api-key`, cuerpo `text` (1–500), `speaker` (id), `emotion?`. **5.000 caracteres gratuitos de API.** | Adaptador + modelo `topmediai:text2speech`. **Sin verificar**: no se vio la forma de la respuesta; acepta audio directo o JSON con URL y si no la reconoce falla de forma explícita. Siempre pide confirmación. |
| Consulta de créditos | Sí | `GET /v1/get_api_key_info` | Botón «Comprobar TopMediai (sin coste)» en Conectores; solo devuelve campos numéricos/estado, nunca la clave ni el correo. |
| Música | Sí | `POST /v2/submit` + consulta de tarea (rutas de estado no confirmadas); planes mensuales de créditos | **No cableada**: faltan las rutas/respuesta de consulta y la API no sirve con tu suscripción. |
| Efectos de sonido | **No** | Solo herramienta web | Importador. |
| Descarga / gestión de trabajos | Parcial | Estado por id de canción; descarga por URL | Importador (manual). |
| ¿Incluida en tu suscripción? | **No** | FAQ: la API de voz y la de covers "no están incluidas en los planes"; la de música "no se aplica al generador online". Precios de la API de música contradictorios entre páginas ($69,99–$149,99/mes; prueba de 100 créditos $9,99). | — |

**Derechos de uso**: comercial solo con plan de pago (certificado PDF por pista); plan gratuito = uso personal; las pistas no pueden registrarse en Content ID como composiciones originales. El importador guarda «Con licencia» solo si confirmas un plan de pago; si no, «Restringido (no comercial)».

**Por qué no hay automatización web**: no se hace scraping ni se simula un navegador sobre tu cuenta (vulneraría sus condiciones). La vía es: descargas tus archivos → los arrastras a *Música y sonidos → Importar de TopMediai*.

## Créditos gratuitos: tres tipos distintos

| Tipo | Ejemplos | Cómo lo trata Cerebro |
|---|---|---|
| **Diario** | Cloudflare 10.000 neuronas (00:00 UTC), Groq, Gemini texto (20/día en gratis) | Contador por UTC; avisa y recomienda alternativa gratuita al agotarse. |
| **Mensual** | ElevenLabs (saldo en vivo), Hugging Face $0,10, Google AI Pro $10 de Cloud | Contador mensual; ElevenLabs lee su saldo real. |
| **Promocional** | Alibaba Wan 30–50 s/90 días, TopMediai 5.000 caracteres, créditos de bienvenida | No se renuevan; caducan (`DASHSCOPE_PROMO_START` para saber cuándo). |

Cerebro **solo cuenta lo que genera él mismo** (cada activo guarda `allowancePool` y `allowanceUnits`). El uso en la web del proveedor es invisible para él: el rechazo del proveedor siempre manda.

## Sistema inteligente de proveedores

Criterios (`lib/providers/router.ts`): calidad mínima · créditos gratuitos restantes · coste estimado · velocidad · formato/duración · **resolución mínima** · **imágenes de referencia necesarias** · **uso comercial** · **evidencia**.

Reglas que no se pueden saltar:
1. **Nunca se cambia solo a un modelo de pago.** `recommendAlternatives` devuelve una lista gratuita (lo recomendado) y otra de pago marcada `requiresAuthorization` (solo informativa). El usuario elige con un clic y el coste se confirma como siempre.
2. **Un modelo con cupo gratuito no se envía si el contador local indica que no cabe** (evita, por ejemplo, el cobro automático de Alibaba tras la cuota).
3. **Un modelo de pago exige `confirmedEstimateUsd` ≥ la estimación**; el servidor lo rechaza si falta o es menor.
4. Las integraciones **sin verificar** o con **precio no publicado** solo se usan si se eligen a mano.

## Qué no se pudo verificar (y por qué)

- Todo lo de **Cloudflare**, **OpenAI**, **fal**, **Alibaba** y **TopMediai**: no hay claves en esta sesión y el proxy deniega esos dominios. Los adaptadores se probaron con respuestas simuladas que reproducen la documentación, no con el servicio real.
- La **respuesta real** de TopMediai text2speech y las rutas de consulta de su API de música.
- El **nombre exacto** del modelo Wan (`wan2.2-t2v-plus`) y el id `gpt-image-2`: vienen de documentación/terceros. Si el proveedor los rechaza, la llamada falla sin coste.
- Precios de Nano Banana 2/Lite y de GPT Image 2.

## Fuentes consultadas (vía buscador, 2026-10-10)

- Gemini API, Veo 3.1 sin nivel gratuito: <https://benchlm.ai/media-pricing/veo> · <https://www.atlascloud.ai/blog/guides/veo-3.1-ai-video-generator-free-or-paid> (terceros)
- Gemini image sin nivel gratuito: <https://www.aifreeapi.com/en/posts/gemini-image-generation-free-tier> · <https://blog.laozhang.ai/en/posts/gemini-3-pro-image-free-tier> (terceros, confirmado por la prueba en vivo)
- Alibaba Model Studio, cuota de nuevos usuarios: <https://www.alibabacloud.com/help/en/model-studio/new-free-quota> · guía Wan: <https://www.alibabacloud.com/help/en/model-studio/text-to-video-guide>
- Z.ai CogVideoX-3: <https://docs.z.ai/guides/video/cogvideox-3> · precios: <https://docs.z.ai/guides/overview/pricing>
- Kling API (prepago): <https://www.atlascloud.ai/blog/tips/kling-ai-api-pricing> (tercero)
- Pika vía fal: <https://fal.ai/models/fal-ai/pika/v2.2/text-to-video>
- LTX-2: <https://help.ltx.io/hc/en-us/articles/32478713737618-Understanding-LTX-2-API-Pricing>
- Cloudflare Workers AI precios: <https://developers.cloudflare.com/workers-ai/platform/pricing/> · FLUX.2 klein 4B: <https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/> · FLUX.2 dev (referencias): <https://developers.cloudflare.com/changelog/post/2025-11-25-flux-2-dev-workers-ai/> · errores: <https://developers.cloudflare.com/workers-ai/platform/errors/> · modelos que requieren plan de pago: <https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/>
- BFL FLUX.2 precios: <https://docs.bfl.ml/quick_start/pricing>
- OpenAI GPT Image (terceros): <https://costgoat.com/pricing/openai-images> · <https://www.aifreeapi.com/en/posts/gpt-image-1-5-pricing-api>
- Google AI Pro + créditos de Cloud: <https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/>
- TopMediai: <https://docs.topmediai.com/api-reference/text-to-speech/text-to-speech> · <https://docs.topmediai.com/api-reference/x-api-key-info/get-api-key-info> · <https://docs.topmediai.com/api-reference/ai-music-generator/v2-generate-music> · <https://www.topmediai.com/api/text-to-speech-api/purchase/> · <https://www.topmediai.com/api/ai-music-generator-api/purchase/> · <https://www.topmediai.com/terms-conditions/>
- Rankings de imagen (terceros): <https://techsy.io/en/blog/best-ai-image-models> · <https://howaiworks.ai/blog/best-ai-image-model>
