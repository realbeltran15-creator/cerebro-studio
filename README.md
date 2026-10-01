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
| Imágenes / Vídeo / Voz | Preparado para integración | Necesitan claves de servidor. Voz: ElevenLabs (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, voces de la cuenta seleccionables) con OpenAI TTS como respaldo; efectos de sonido con ElevenLabs en Música y sonidos. Google Flow sin API pública oficial confirmada |
| Analytics | Parcial | Conexión OAuth del canal (solo lectura; tokens cifrados AES-256-GCM en `channel_connections`) e importación de YouTube Analytics v2 a `metric_snapshots`: serie diaria del canal y vídeos principales. Requiere `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY` |
| Miniaturas | Preparado para integración | Variantes 16:9 por proyecto con el proveedor de imágenes (`OPENAI_API_KEY`), guardadas como assets `thumbnail`; selección de la definitiva |
| Radar | Funcional | Tendencias oficiales de YouTube (`chart=mostPopular`) por país y categoría, ~2 unidades de cuota por consulta; términos recurrentes calculados sobre los títulos; guardar como oportunidad. Histórico en `trend_snapshots` (cada lectura del Radar y de la vigilancia de tendencias) con entradas nuevas, cambios de puesto, vídeos que salen y vistas ganadas |
| Música y sonidos | Funcional | Subida de música y efectos propios, con licencia o de dominio público al almacenamiento privado, con licencia, enlace de origen, duración y ambiente registrados. Sin proveedor de música generativa |
| Editor de vídeo | Funcional | Montaje por escenas del storyboard guardado en `render_jobs.composition`: imagen/vídeo, voz (generable por escena), duración ajustable a la voz, zoom lento, transiciones, música con ducking y subtítulos incrustados. Render en el navegador (canvas + WebAudio + MediaRecorder, WebM ≤ 50 MB) guardado en la Biblioteca con procedencia y licencias de las entradas |
| Shorts / Reels / TikTok | Funcional | Deriva una versión 9:16 de un montaje del Editor: selección de escenas, reencuadre horizontal por escena, hook en pantalla (prellenado con el hook del guion), subtítulos y comprobación de límites (Shorts 3 min, Reels 90 s, TikTok 10 min). Renderiza con el mismo motor; no publica |
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

**Selección** (`lib/providers/router.ts`): manual o por estrategia — gratis y créditos primero, solo gratis, más barato, máxima calidad, más rápido — teniendo en cuenta claves configuradas, créditos agotados, formato, duración y capacidades. La estrategia solo elige: generar siempre exige confirmar, y el servidor rechaza una generación de pago sin el coste confirmado.

**Bancos gratuitos** (`lib/providers/stock.ts`): Freesound (CC0/BY/BY-NC), Pexels y Pixabay. Se importa a la Biblioteca con autor, licencia, atribución y página de origen.

**Costes y créditos** (`/usage`): generaciones por proveedor/modelo, coste estimado y real, créditos gastados (ElevenLabs devuelve `character-cost`), saldo en vivo de ElevenLabs y estrategia por defecto.

### Google Flow

| Capa | Qué es | Integración |
|---|---|---|
| Flow (producto) | Interfaz web; créditos de Flow en Google AI Pro (1.000/mes) y Ultra (10.000/mes) | Sin API pública. No se automatiza con métodos no oficiales |
| Modelos | Veo 3.1, Imagen, Nano Banana, Lyria, Gemini TTS | — |
| API oficial | Gemini API (`GEMINI_API_KEY`) / Vertex AI | Integrado: Veo 3.1 Fast (vídeo) y Gemini TTS (voz, nivel gratuito) |

Google AI Pro incluye además $10/mes (Ultra $40/mes) en créditos de Google Cloud vía Google Developer Program; hay que confirmar en la consola de facturación que se aplican al proyecto de la API.

## Migraciones

- `20260926120000_scripts_module.sql` (aditiva): crea `public.scripts` con RLS y añade `storyboards.script_id`. Aplicada en la base desplegada (versión `20260926151554`); esquema, RLS y flujo guion → versión → storyboard → escenas verificados con transacciones revertidas.
- `20260926190000_automations.sql` (aditiva): crea `public.automations` y `public.automation_runs` con RLS por propietario. Aplicada en la base desplegada; RLS verificado con transacción revertida.
- `20260926230000_trend_snapshots.sql` (aditiva): histórico del Radar con RLS por propietario. Aplicada; RLS verificado con transacción revertida.
- Aviso: los archivos `20260916*` del repositorio no reflejan exactamente el esquema desplegado (p. ej. `scenes.narration`, `metric_snapshots.observed`, `assets.asset_type`). El esquema desplegado es la referencia; `lib/types/database.ts` sigue al desplegado.
