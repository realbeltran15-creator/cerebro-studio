# Cerebro Studio

AI audiovisual production and market-intelligence platform.

## Architecture

- Next.js + TypeScript frontend/server
- Supabase database, auth and storage
- Vercel deployment
- Official platform APIs and OAuth connectors
- Approval gates before publishing or external actions
- Rendering workers/FFmpeg for heavy audiovisual processing

## Core workflow

Market intelligence → opportunity → approval → production → storyboard → assets → render → repurpose → publication approval → distribution → analytics → learning.

## Security principles

- Row Level Security on user-owned data
- No secrets committed to Git
- OAuth tokens handled server-side only
- Audit trail and explicit publication approvals
- Asset provenance/licensing metadata

## Estado real de los módulos

La fuente de verdad es `lib/module-status.ts`; la interfaz la lee para no presentar como terminado algo que solo carga.

| Módulo | Estado | Nota |
|---|---|---|
| Inicio (dashboard) | Funcional | Datos reales; sin métricas inventadas |
| Proyectos + espacio de proyecto (`/projects/[id]`) | Funcional | Progreso derivado de los datos: investigación → guion → storyboard → recursos → publicación → resultados |
| Guiones | Funcional | Versiones, secciones con base factual (hecho / testimonio / reconstrucción / interpretación), avisos de fuentes, conversión a storyboard. Asistencia IA (hooks y estructura) con `OPENAI_TEXT_API_KEY` u `OPENAI_API_KEY`: propone, no guarda; solo cita fuentes de la investigación del proyecto |
| Storyboard y escenas | Funcional | Cámara, acción, música, SFX, estado final y continuidad entre escenas |
| Oportunidades | Funcional | Búsqueda, filtros, estados y conversión a proyecto. Métricas observadas y calculadas por separado y legibles, orden por vistas/día, ratio vistas/suscriptores o crecimiento reciente, historial de vistas y actualización desde YouTube (una o todas) |
| Investigación / YouTube | Funcional | Análisis de canales (estadísticas, últimos 25 vídeos, mediana/media, subidas por semana y vídeos destacados ≥ 2× la mediana, ~4 unidades de cuota) y búsqueda con YouTube Data API (`YOUTUBE_API_KEY`, solo lectura, ~102 unidades de cuota por búsqueda) con métricas observadas y calculadas por separado; registro manual con fuente y control de duplicados |
| YouTube (publicación) | Parcial | Borradores con vídeo renderizado, miniatura, descripción, etiquetas, categoría y privacidad (privado por defecto). Dos pasos explícitos: aprobar (registro en `approvals`, bloqueado si alguna entrada tiene licencia sin verificar) y publicar (subida reanudable, idempotente, `assertPublicationApproved` en servidor). Requiere OAuth con permiso de subida |
| Imágenes / Vídeo / Voz | Funcional (redirigen al Estudio) | `/images`, `/videos` y `/voices` redirigen a `/studio`, que concentra la generación multiproveedor con confirmación de coste. Cada proveedor se activa con su clave de servidor. Google Flow sin API pública oficial: se usan Veo/Gemini API |
| Analytics | Parcial | Conexión OAuth del canal (solo lectura; tokens cifrados AES-256-GCM en `channel_connections`) e importación de YouTube Analytics v2 a `metric_snapshots`: serie diaria del canal y vídeos principales. Requiere `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY` |
| Miniaturas | Funcional | Variantes 16:9 por proyecto con cualquier proveedor de imagen configurado; el modo automático solo considera modelos con la calidad requerida (y texto legible si la miniatura lleva texto) y elige el de menor coste; coste visible antes de generar. Guardadas como assets `thumbnail`; selección de la definitiva |
| Radar | Funcional | Tendencias oficiales de YouTube (`chart=mostPopular`) por país y categoría, ~2 unidades de cuota por consulta; términos recurrentes calculados sobre los títulos; guardar como oportunidad. Histórico en `trend_snapshots` (cada lectura del Radar y de la vigilancia de tendencias) con entradas nuevas, cambios de puesto, vídeos que salen y vistas ganadas |
| Música y sonidos | Funcional | Generación de música, efectos y ambientes (ElevenLabs, Lyria vía fal.ai), búsqueda en Freesound con licencia, y subida de audio propio o licenciado con licencia, origen, duración y ambiente registrados |
| Editor de vídeo | Funcional | Montaje por escenas del storyboard guardado en `render_jobs.composition`: imagen/vídeo, voz (generable por escena), duración ajustable a la voz, zoom lento, transiciones, música con ducking y subtítulos incrustados. Render en el navegador (canvas + WebAudio + MediaRecorder, WebM ≤ 50 MB) guardado en la Biblioteca con procedencia y licencias de las entradas |
| Shorts / Reels / TikTok | Funcional (parcial en selección automática) | Deriva una versión 9:16 de un montaje del Editor: sugerencia de tramo calculada con heurística determinista (`lib/editor/repurpose.ts`; etiquetada «Calculado, no IA»; no usa audio ni transcripción todavía), selección de escenas, reencuadre horizontal por escena, hook en pantalla (prellenado con el hook del guion), subtítulos y comprobación de límites (Shorts 3 min, Reels 90 s, TikTok 10 min). Renderiza con el mismo motor; no publica |
| Automatizaciones | Parcial | Vigilancia de tendencias (país, categoría, palabras clave, guardado sin duplicados) y actualización de métricas de oportunidades de YouTube con historial y crecimiento. Ejecución manual; la diaria (Vercel Cron 07:00 UTC, `/api/cron/automations`) usa `CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` (ya configuradas) y Vercel solo la dispara en producción. Solo leen fuentes y escriben en el workspace: nunca publican |

## Estudio de creación (`/studio`)

Un único lugar para generar con varios proveedores, revisar el resultado en grande y guardarlo en la Biblioteca del proyecto.

| Tipo | Modelos | Variables de servidor |
|---|---|---|
| Imagen | OpenAI GPT Image · FLUX.2 Pro · Nano Banana Pro · Ideogram 3 | `OPENAI_API_KEY` · `FAL_KEY` |
| Vídeo | Kling 2.5 Turbo Pro · Google Veo 3 Fast (con sonido) | `FAL_KEY` |
| Voz | ElevenLabs Multilingual v2 (voces de la cuenta, estabilidad/expresividad/velocidad) · OpenAI `gpt-4o-mini-tts` con dirección de locución | `ELEVENLABS_API_KEY` · `OPENAI_VOICE_API_KEY` |
| Música | ElevenLabs Music (`/v1/music`) · Google Lyria 2 | `ELEVENLABS_API_KEY` · `FAL_KEY` |
| Efectos | ElevenLabs sound generation | `ELEVENLABS_API_KEY` |

- Catálogo en `lib/providers/catalog.ts` (endpoints y precios de lista comprobados el 2026-09-30; los precios son estimaciones y se guardan como tales en la procedencia).
- "Mejorar con ChatGPT" reescribe la idea como prompt del modelo elegido (`OPENAI_TEXT_API_KEY` u `OPENAI_API_KEY`). No guarda nada.
- Cada generación pide confirmación con el coste estimado. Nada se reintenta solo.
- fal.ai funciona por cola: el servidor devuelve un token cifrado (`TOKEN_ENCRYPTION_KEY`) y la página consulta `/api/studio/job`; el resultado se guarda una sola vez aunque se consulte varias veces.
- Si se elige una escena, el asset guarda `provenance.sceneId` y el editor lo muestra primero (★) en esa escena.

## Capa multiproveedor

Tres piezas desacopladas; añadir un proveedor no cambia el flujo de creación:

1. **Directorio** (`lib/providers/directory.ts`): quién es cada proveedor, nivel de coste (Gratis · Créditos incluidos · Freemium · De pago · Local), autenticación, cupo gratuito, condiciones, enlaces a documentación y fecha de comprobación.
2. **Catálogo** (`lib/providers/catalog.ts`): modelos por tipo (imagen, vídeo, voz, música, efectos, ambientes) con calidad, velocidad, límites, capacidades, formatos y coste estimado (`priceConfirmed: false` = precio de referencia).
3. **Adaptadores** (`lib/providers/adapters`): `startGeneration` / `pollGeneration` por proveedor (OpenAI, fal.ai, ElevenLabs, Cloudflare Workers AI, Gemini API).

**Regla global: calidad primero + optimización de costes** (`lib/providers/router.ts`, `lib/providers/text.ts`): primero se fija la calidad necesaria (Borrador 2 · Estándar 3 · Alta 4 · Máxima 5), después las capacidades (formato, duración, audio…) y solo entre los modelos que las cumplen se elige el más barato: gratis → créditos incluidos → freemium → de pago, y menor precio. Un modelo barato nunca sustituye a uno que la tarea necesita. Modos: *Mejor relación calidad-coste* (por defecto), *Gratis solamente*, *Máxima calidad*, *Más rápido* y *Proveedor específico* (manual). La estrategia solo elige: generar siempre exige confirmar, y el servidor rechaza una generación de pago sin el coste confirmado.

**Texto y razonamiento** (`lib/providers/text.ts`): cada tarea declara su calidad mínima (etiquetas 2, mejorar prompts 3, hooks/packaging/análisis 4, borrador de guion 5). Proveedores: Groq GPT-OSS 120B/20B (freemium), Gemini 3.8 Flash (nivel gratuito, Interactions API) y OpenAI (`OPENAI_TEXT_MODEL`). Salida JSON validada; si un proveedor falla o devuelve algo incompleto se prueba el siguiente que alcance la calidad. Cada llamada registra proveedor, modelo, tarea, tokens y coste estimado (`text-usage` en los logs del servidor).

**Pasarela propia** (`TEXT_GATEWAY_*`): cualquier endpoint compatible con OpenAI, como OmniRoute con `eco-router`, entra como proveedor local y gratuito. Su calidad la declara el usuario (`TEXT_GATEWAY_QUALITY`) y solo se usa en las tareas que no exigen más.

**Higgsfield** (API oficial): imagen Soul y vídeo Kling 2.5 Turbo Pro y Hailuo 2.3, pagados con créditos de la cuenta. Su precio por modelo no está publicado, así que nunca lo elige una estrategia automática: hay que escogerlo a mano y confirmar.

**Transcripción** (`lib/providers/transcribe.ts`, `/api/transcribe`): Whisper large v3 (Groq) primero por precisión, turbo (Groq o Cloudflare, gratis) como respaldo. Genera subtítulos VTT guardados en la Biblioteca y SRT copiable.

**Bancos gratuitos** (`lib/providers/stock.ts`): Freesound (CC0/BY/BY-NC), Pexels y Pixabay. Se importa a la Biblioteca con autor, licencia, atribución y página de origen.

**Costes y créditos** (`/usage`): generaciones por proveedor/modelo, coste estimado y real, créditos gastados (ElevenLabs devuelve `character-cost`), saldo en vivo de ElevenLabs y estrategia por defecto.

### Google Flow

| Capa | Qué es | Integración |
|---|---|---|
| Flow (producto) | Interfaz web; créditos de Flow en Google AI Pro (1.000/mes) y Ultra (10.000/mes) | Sin API pública. No se automatiza con métodos no oficiales |
| Modelos | Veo 3.1, Imagen, Nano Banana, Lyria, Gemini TTS | — |
| API oficial | Gemini API (`GEMINI_API_KEY`) / Vertex AI | Integrado: Veo 3.1 Fast (vídeo) y Gemini TTS (voz, nivel gratuito) |

Google AI Pro incluye además $10/mes (Ultra $40/mes) en créditos de Google Cloud vía Google Developer Program; hay que confirmar en la consola de facturación que se aplican al proyecto de la API.

## Publicación en redes (`/youtube`, `/social`)

Todo con APIs oficiales y OAuth; los tokens se guardan cifrados (AES-GCM). Ninguna publicación ocurre sin dos acciones del propietario: aprobar (escribiendo APROBAR, con resumen de riesgos y bloqueo por licencias sin verificar) y pulsar publicar. Idempotente por trabajo.

- **YouTube**: YouTube Data API v3, subida reanudable, privado por defecto.
- **Instagram (Reels)**: Instagram API with Instagram Login (`instagram_business_basic`, `instagram_business_content_publish`). Contenedor `REELS` con URL firmada temporal → espera de procesamiento (reanudable) → `media_publish`. Solo MP4/MOV: los renders WebM del navegador no se aceptan (pendiente: render MP4 en servidor).
- **TikTok**: Login Kit + Content Posting API (`video.publish`), subida `FILE_UPLOAD` por fragmentos, privacidad validada con `creator_info` y **SELF_ONLY por defecto**; etiqueta de contenido IA activada por defecto. Las apps sin auditar solo pueden publicar en privado.

## Almacenamiento en la nube

Todo lo que se crea (renders, subidas, generaciones, importaciones, subtítulos) se guarda en la nube, nunca en el equipo del usuario. `lib/storage/server.ts` elige el destino:

- **Cloudflare R2** (si `R2_*` está configurado): 10 GB-mes gratis, salida gratis y archivos de hasta ~5 TB. El navegador sube directamente con URLs presignadas (SigV4, probada con el vector oficial de AWS); las rutas se guardan como `r2:<clave>`.
- **Supabase Storage** (por defecto): el plan gratuito limita a 50 MB por archivo y 1 GB en total.

Los archivos ya guardados en Supabase siguen funcionando. Configuración CORS del bucket R2 (Cloudflare → R2 → bucket → Settings → CORS policy):

```json
[{ "AllowedOrigins": ["https://cerebro-studio.vercel.app", "http://localhost:3000"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
```

## Edición automática y «Aprende de mí»

- **Render MP4**: el editor graba MP4 (H.264 + AAC) en Chrome, Edge y Safari, que es lo que piden Reels, TikTok y YouTube; Firefox sigue en WebM.
- **Montaje automático** (`/editor/auto`): sin IA ni coste. Analiza el vídeo en bruto en el navegador, quita silencios (jump cuts), corta en los cambios de plano y divide las tomas largas. Después pone transiciones, música y subtítulos de la transcripción, y exporta.
- **Aprende de mí** (editor manual): «Grabar mi forma de editar» mide lo que hace el usuario: duración de los cortes, divisiones, transiciones, zoom, textos, volúmenes y efectos en los cortes. Lo guarda como estilo (en `connector_configs`, solo del propietario), lo afina con cada sesión y lo aplica a otros montajes, con opción de deshacer. Graba acciones del editor, no la pantalla: así el resultado es exacto y repetible.
- CapCut no tiene API oficial de edición; no se integra.

## Migraciones

- `20260926120000_scripts_module.sql` (aditiva): crea `public.scripts` con RLS y añade `storyboards.script_id`. Aplicada en la base desplegada (versión `20260926151554`); esquema, RLS y flujo guion → versión → storyboard → escenas verificados con transacciones revertidas.
- `20260926190000_automations.sql` (aditiva): crea `public.automations` y `public.automation_runs` con RLS por propietario. Aplicada en la base desplegada; RLS verificado con transacción revertida.
- `20260926230000_trend_snapshots.sql` (aditiva): histórico del Radar con RLS por propietario. Aplicada; RLS verificado con transacción revertida.
- Aviso: los archivos `20260916*` del repositorio no reflejan exactamente el esquema desplegado (p. ej. `scenes.narration`, `metric_snapshots.observed`, `assets.asset_type`). El esquema desplegado es la referencia; `lib/types/database.ts` sigue al desplegado.

## Dependencias y avisos de `npm audit`

`npm audit --omit=dev` → 0 vulnerabilidades (producción). Los 5 avisos altos restantes son solo de desarrollo y transitivos: `braces` (DoS por patrones glob muy anidados) vía `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next`. Solo se ejecutan en el linter con patrones propios, sin entrada de usuarios. `npm audit fix --force` propone fijar `eslint-config-next@14.2.35` (un cambio de versión mayor incompatible con la versión de Next del proyecto), por lo que no se aplica; se resolverá al actualizar `eslint-config-next` junto con Next.

## Verificación de Gemini (2026-10-07)

Comprobado contra la API oficial sin generar nada (listado de modelos, `models.get` y `countTokens`, gratuitos):

- La clave llegó a esta sesión como *Network Secret* de `generativelanguage.googleapis.com`: el proxy añade `x-goog-api-key` a la petición, así que el proceso **no** ve `process.env.GEMINI_API_KEY`. El código de Cerebro Studio es compatible: envía la cabecera con lo que haya en la variable (vacía o de relleno) y el proxy la sustituye. En Vercel la variable real existe y no hace falta cambiar nada.
- Consecuencia solo en entornos con Network Secret: `isConfigured` mira la variable de entorno, por lo que el Estudio mostraría «Sin clave» para Gemini aunque la API respondiera. Para probar la app allí hay que definir `GEMINI_API_KEY` con un valor de relleno no secreto.
- Los identificadores que usa el código existen hoy: `gemini-3.8-flash` (texto), `gemini-3.8-flash-tts` (voz) y `veo-3.1-fast-generate-preview` (vídeo). `gemini-2.5-flash` ya no está disponible para cuentas nuevas y el código no lo usa.
- Pruebas en vivo con la clave del nivel gratuito (propietario confirmó proyecto Free tier sin facturación), a través del código de la app (`tests/live/gemini.live.test.ts`, opt-in): enrutado calidad-primero correcto (Gemini solo para tareas de calidad ≤ 4; `script_draft` no se degrada), selección de Gemini TTS para voz en español con «gratis solamente», y **voz generada y verificada** (WAV, procedencia con modelo y uso). Veo no se ha probado a propósito.
- **Texto con Gemini: sin validar en vivo**: el 2026-10-07 `gemini-3.8-flash` y `gemini-3-flash-preview` respondieron 503 («high demand») de forma sostenida y la petición estructurada, 502. La integración lo gestiona (reintento único del mismo modelo ante 502/503/504, estado conservado en `TextRouteError`, mensaje claro en la UI; tests con `fetch` simulado). Falta repetir cuando Google estabilice el modelo.
- En el sandbox, Node solo usa el proxy que inyecta la clave con `NODE_USE_ENV_PROXY=1` (y `NODE_EXTRA_CA_CERTS`); sin ello la petición va directa con el valor de relleno y Google responde 400.

## Verificación de YouTube Data API (2026-10-07)

- `YOUTUBE_API_KEY` añadida como Network Secret para `www.googleapis.com`, **pero esa sesión no la recibió**: `videos.list` sin clave daba 403 «unregistered callers» y con un valor de relleno 400 «API key not valid»; la inyección de Gemini (otro host) seguía funcionando. Por eso no se hicieron llamadas reales a YouTube. No se intentó obtener la clave por otras vías.
- Corregido un fallo real de seguridad/compatibilidad: el código enviaba la clave en la URL (`?key=…`), lo que la deja en registros y trazas y no es sustituible por un secreto inyectado por cabecera. Ahora usa `x-goog-api-key` (soportada por la API) y hay un test que garantiza que la clave nunca va en la URL. Las demás llamadas a YouTube usan OAuth con `Authorization: Bearer`.
- Pruebas en vivo preparadas y opcionales (`tests/live/youtube.live.test.ts`, solo lectura pública, ~102 unidades de cuota por la búsqueda): búsqueda con deduplicación y métricas observadas/calculadas, categorías y tendencias, vídeos por id y análisis de canal. Se ejecutan con `LIVE_YOUTUBE=1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca> npx vitest run tests/live/youtube` cuando el secreto llegue a la sesión.

## Pruebas de navegador (`npm run test:browser`)

Chromium real con Supabase y `next/*` simulados (nada sale de la máquina): renderer de vídeo, editor manual, «Aprende de mí», Estudio de creación, y una **batería móvil** que monta 20 pantallas reales a 390 px y comprueba que no hay desbordamiento horizontal ni errores de página, y que `axe-core` (WCAG A/AA) no detecta fallos de contraste, nombres o etiquetas. Limitaciones: se ejecuta con datos de prueba casi vacíos (cubre estados vacíos y la estructura, no listas largas reales) y no monta `app/layout.tsx` (idioma y título se comprueban aparte). `--faint` se aclaró a `#8189a8` porque el gris anterior no llegaba a 4,5:1 sobre los fondos oscuros.

## MP4 y Instagram (2026-10-07)

- El renderer graba con `MediaRecorder`: elige primero MP4 con H.264 + AAC (Chrome, Edge y Safari de escritorio), después WebM, y como último recurso `video/mp4` sin códec. Comprobado en el Chromium de pruebas (sin H.264): ese último recurso produce un **MP4 válido pero con vídeo VP9**, que Instagram rechaza (pide H.264 o HEVC con AAC).
- Por eso el tipo MIME completo (con códec) se guarda en la procedencia y `instagramReadiness()` (`lib/editor/container.ts`) decide en un solo sitio: aviso al terminar el render, marca en la lista de vídeos y bloqueo al publicar. MP4 antiguos sin códec registrado se permiten con aviso.
- No hay conversión en servidor: en Vercel gratuito no hay FFmpeg, y no se simula cambiando la extensión. Quien renderice en Firefox obtiene WebM; para Instagram debe renderizar en Chrome, Edge o Safari. Una conversión WebM→MP4 en el navegador (ffmpeg.wasm) o en un worker propio sería una decisión de coste/arquitectura pendiente.

## Repurposing: hook y paquete (2026-10-07)

Además de sugerir el tramo, la pantalla propone el **hook en pantalla** (la frase inicial más fuerte del tramo: pregunta, cifra, frase corta, recortada a 90 caracteres) y un **borrador de título, descripción y hashtags** con el texto del propio proyecto, con botones de copiar. Todo es heurístico, determinista, sin IA ni coste y rotulado «Calculado, no IA». Probado con tests unitarios y una prueba de navegador con un montaje sembrado a 390 px. Pendiente: usar la transcripción/audio (picos de energía, pausas) y el reencuadre automático por contenido.

## Aprendizaje desde Analytics (2026-10-07)

`lib/analytics/learning.ts` compara tus vídeos entre sí con las métricas observadas importadas: cuáles superaron 2× la mediana de vistas, cuáles retienen más (porcentaje visto) y las vistas medianas por duración aproximada. Es **descriptivo y calculado**, no explica causas, exige al menos 5 vídeos y lo dice en pantalla. Probado con tests unitarios y navegador sobre datos sembrados; **no** probado con datos reales porque depende del OAuth de Google. Pendiente: usar estas señales para sugerir temas/formatos al crear guiones y priorizar oportunidades.

## Duplicados de oportunidades (2026-10-07)

Antes solo había comprobación en la aplicación (consultar y luego insertar), sin restricción en la base: dos pestañas o una automatización a la vez podían duplicar. Comprobado en la base desplegada (solo lectura): 1 oportunidad, sin duplicados ni índice único. Preparada la migración **`20261007120000_opportunities_unique_source.sql`** (índice único parcial por propietario + plataforma + `source_id`; las manuales sin fuente no se ven afectadas) y **aplicada el 2026-10-07** tras comprobar que era segura (1 fila, 0 duplicados, índice inexistente, sin cambios de datos), con prueba de rechazo de duplicado revertida y retroceso con `drop index public.opportunities_owner_source_unique`. El código ya trata el conflicto (`23505`) como «ya estaba guardado» (`lib/opportunities.ts`, usado por automatizaciones, resultados de YouTube y captura manual), con tests de concurrencia simulada.

## YouTube Data API: validación real (2026-10-07)

La clave llegó como Network Secret (`www.googleapis.com`, cabecera `x-goog-api-key`, restringida a YouTube Data API v3) y **las pruebas en vivo de solo lectura pasan** a través del código de la app (`tests/live/youtube.live.test.ts`, 5 pruebas): búsqueda con deduplicación (5 resultados, 5 únicos) y métricas observadas separadas de las calculadas (vistas, suscriptores, vistas/día, ratio vistas/suscriptores, engagement, fecha de lectura), vídeos por id (ids desconocidos ignorados), 14 categorías asignables de España, tendencias por país, análisis de canal (muestra, mediana, subidas por semana, vídeos destacados) y un rechazo real de la API (región inválida) convertido en `YouTubeApiError` sin la clave en el mensaje. Coste de cuota: ~100 unidades por la búsqueda más unas pocas unidades por lectura (cuota diaria gratuita de 10 000).

Sigue sin probarse con cuenta real: analytics privado, subida y publicación (requieren OAuth del propietario; no se hace nada de escritura).

La vigilancia de tendencias también se validó con datos reales de YouTube y una base simulada en memoria (`tests/live/automation.live.test.ts`, sin escribir en ningún sitio): coincidencia por palabra clave con una palabra real de los títulos en tendencia, oportunidades con métricas observadas y evidencia (URL del vídeo, sin la clave) y deduplicación en una segunda ejecución. Nota: la automatización ignora palabras clave de menos de 3 letras.

## fal.ai (vídeo, imagen, música) — integración y puesta en marcha (2026-10-07)

**Estado:** integración completa en código y probada con servidor simulado; **sin validar con la cuenta real** (falta la clave). Cola `queue.fal.run` (envío único, nunca se reenvía; estado y resultado con hasta 2 reintentos solo en lecturas), token cifrado por trabajo, guardado idempotente en la Biblioteca con proyecto, escena, modelo, prompt, parámetros, coste estimado y `externalId`, y mensajes claros para clave inválida (401), cuenta sin saldo o sin permiso (403), parámetros no válidos (422), límite (429) y filtro de seguridad.

**Dominios necesarios:** `queue.fal.run` (API) y la CDN de archivos `v3.fal.media`, `v3b.fal.media` y `fal.media` (descarga del resultado; el código acepta `fal.media` y subdominios y rechaza cualquier otro host; si fal cambiara de CDN, se añade en `FAL_EXTRA_MEDIA_HOSTS` sin tocar código). El dominio `fal.run` ya no se usa (se eliminó el adaptador de prueba síncrono sin verificar).

**Autenticación:** cabecera `Authorization` con valor `Key <clave>` (prefijo `Key ` con espacio). Variable de servidor: `FAL_KEY` (Vercel). Para pruebas desde el sandbox, Network Secret con host `queue.fal.run`, cabecera `Authorization` y prefijo `Key `.

**Modelos de vídeo:** Kling 2.5 Turbo Pro (5 s ≈ $0.35, +$0.07/s), Veo 3 Fast ($0.10/s sin audio, $0.15/s con audio) y, para pruebas de coste mínimo, **Wan 2.2 5B Fast** (`fal-ai/wan/v2.2-5b/text-to-video/fast-wan`, ≈ $0.025 por clip a 720p según la ficha pública de fal; calidad de borrador, precio sin confirmar). Los precios proceden de la información pública de fal y deben confirmarse en el panel.

**Pruebas:** `tests/fal-integration.test.ts` (sin red ni gasto). En vivo y opcionales: `tests/live/fal.live.test.ts` con dos permisos separados: `LIVE_FAL=1` (sondeo con cuerpo vacío: se espera 422, sin trabajo ni cobro) y `FAL_ALLOW_SPEND=yes` (una generación real de borrador, solo con autorización de coste del propietario).

## MP4 compatible con Instagram/TikTok/YouTube: comparación y solución (2026-10-07)

| Vía | Coste | Resultado | Estado |
|---|---|---|---|
| **Chrome, Edge, Safari recientes** (`MediaRecorder` con `avc1` + `mp4a`) | Gratis | MP4 H.264 + AAC nativo, tiempo real | **Vía principal.** El renderer ya la elige primero. No verificable en el Chromium de pruebas (sin H.264). |
| **Firefox / navegadores sin H.264** | — | Solo WebM (o MP4 con VP9, que Instagram rechaza) | Se detecta y se avisa (`instagramReadiness`); se puede convertir con la vía siguiente. |
| **ffmpeg.wasm en el navegador** | Gratis | Recodifica a H.264 (High, yuv420p, 30 fps constantes) + AAC 128k, `faststart` | **Implementada y probada** (`lib/editor/transcode.ts`): un WebM VP9/Opus real sale como MP4 `avc1`+`mp4a`, comprobado leyendo el contenedor. **Desactivada por defecto** (ver licencia). |
| WebCodecs + muxer MIT | Gratis | Rápido y sin núcleo GPL | **No implementada**: `VideoEncoder`/`AudioEncoder` no existen en el Chromium de pruebas, así que no se podría verificar aquí, y el codificador AAC varía por navegador. Candidata futura. |
| Worker propio con FFmpeg en servidor | Pago (infraestructura) | La más fiable para lotes | **No contratada.** En Vercel gratuito las funciones son demasiado cortas para recodificar y no incluyen FFmpeg; haría falta un servicio aparte (y FFmpeg con x264 también es GPL). |

**Cómo funciona la conversión.** Tras renderizar y guardar, si el archivo no sirve para Instagram aparece el botón «Convertir a MP4 compatible (H.264 + AAC)». Re-codifica el vídeo guardado (sin volver a renderizar), comprueba los códecs leyendo la caja `stsd` del MP4 resultante (`mp4Codecs`) y lo guarda como **recurso derivado** (`source_provider: browser-transcode`) que conserva la licencia y las entradas del original y registra `derivedFromAssetId` y los ajustes; el original no se toca. Límite: 200 MB; cancelable; sin telemetría.

**Licencia — decisión del propietario.** El envoltorio `@ffmpeg/ffmpeg` es MIT y está copiado sin cambios en `public/vendor/ffmpeg` (48 KB; un test garantiza que coincide byte a byte con la versión instalada y que no hay `.wasm` ni núcleo en `public`). El **núcleo `@ffmpeg/core` es GPL-2.0-or-later** (incluye x264) y pesa ~32 MB: **no se incluye en el repositorio ni en el despliegue**. Solo se activa si se define `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` apuntando a una carpeta con `ffmpeg-core.js` y `ffmpeg-core.wasm`; así el navegador del usuario lo descarga bajo demanda. Si distribuir ese binario a los usuarios es aceptable para el producto es una decisión legal que no he tomado.

**Límites reales.** Probado con un clip de 2 s a 320×180 en Chromium; el rendimiento con 1080×1920 y varios minutos en ffmpeg.wasm (un solo hilo) no está medido y puede ser lento: es una vía de rescate, no la principal. La reproducción del MP4 resultante no se verificó porque el Chromium de pruebas no decodifica H.264; sí se verificaron los códecs del contenedor.

## Credenciales, dominios y cabeceras por proveedor (2026-10-07)

Para probar un servicio desde el sandbox hay que (1) permitir sus dominios en *Network access* del entorno y (2) añadir la clave como *Network secret* con el host, la cabecera y el prefijo indicados (el proceso solo necesita un valor de relleno no secreto en la variable para que la app considere el servicio configurado). En producción (Vercel) la variable de entorno lleva el valor real. Estado: ✔ validado en vivo · ⏳ preparado y probado con simulaciones, sin validación real.

| Servicio | Variable | Dominios (API y descarga) | Cabecera y valor | Estado |
|---|---|---|---|---|
| Gemini | `GEMINI_API_KEY` | `generativelanguage.googleapis.com` | `x-goog-api-key`, sin prefijo | ✔ voz · texto sin validar (503 de Google) |
| YouTube Data | `YOUTUBE_API_KEY` | `www.googleapis.com` | `x-goog-api-key`, sin prefijo | ✔ solo lectura |
| fal.ai | `FAL_KEY` | `queue.fal.run`, `*.fal.media` | `Authorization`: `Key <clave>` | ⏳ |
| Groq | `GROQ_API_KEY` | `api.groq.com` | `Authorization`: `Bearer <clave>` | ⏳ |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `api.cloudflare.com` | `Authorization`: `Bearer <token>`; el ID de cuenta no es secreto y va en la URL, así que debe ser una variable de entorno normal | ⏳ |
| OpenAI | `OPENAI_API_KEY` (y variantes) | `api.openai.com` | `Authorization`: `Bearer <clave>` | ⏳ |
| ElevenLabs | `ELEVENLABS_API_KEY` | `api.elevenlabs.io` | `xi-api-key`, sin prefijo | ⏳ |
| Freesound | `FREESOUND_API_KEY` | `freesound.org`, `cdn.freesound.org` | `Authorization`: `Token <clave>` | ⏳ |
| Pexels | `PEXELS_API_KEY` | `api.pexels.com`, `images.pexels.com`, `videos.pexels.com` (y `player.vimeo.com/external/` si la API aún lo devuelve) | `Authorization`: `<clave>` (sin prefijo) | ⏳ |
| Pixabay | `PIXABAY_API_KEY` | `pixabay.com`, `cdn.pixabay.com` | **No admite cabecera**: la API exige la clave en la URL (`key=`); no se puede inyectar como Network Secret, va como variable de entorno | ⏳ |

Los dominios de descarga están restringidos en el código por servicio (`allowedDownload`, `isFalMediaUrl`): un resultado nunca puede apuntar al servidor hacia otro host.

## Gemini texto: cupo gratuito (2026-10-07)

Al repetir la prueba, la API respondió 429 con el mensaje «Rate limit exceeded for model gemini-3.8-flash (limit: 20 requests per day on Free Tier)»: **el nivel gratuito de ese modelo admite solo unas 20 solicitudes al día** (dato de la propia respuesta; puede cambiar). Las agoté yo con los reintentos durante la saturación de ese día. Consecuencias: (1) la integración trata el 429 como cupo agotado, no lo reintenta y muestra «límite de uso o cupo gratuito» (ya probado con simulaciones); (2) el catálogo lo indica en la nota de precio; (3) con ese cupo, Gemini sirve como apoyo gratuito, no como único proveedor de texto: conviene configurar también Groq u otro, y el enrutador pasa al siguiente modelo elegible cuando uno falla; (4) la validación en vivo del texto queda pendiente de que se renueve el cupo y no se vuelve a gastar en pruebas repetidas.
