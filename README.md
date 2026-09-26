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
| Oportunidades | Parcial | Búsqueda, filtros, orden, estados y conversión a proyecto; se alimenta desde Investigación |
| Investigación / YouTube | Parcial | Búsqueda con YouTube Data API (`YOUTUBE_API_KEY`, solo lectura, ~102 unidades de cuota por búsqueda) con métricas observadas y calculadas por separado; registro manual con fuente y control de duplicados |
| YouTube (publicación) | Parcial | Borradores con vídeo renderizado, miniatura, descripción, etiquetas, categoría y privacidad (privado por defecto). Dos pasos explícitos: aprobar (registro en `approvals`, bloqueado si alguna entrada tiene licencia sin verificar) y publicar (subida reanudable, idempotente, `assertPublicationApproved` en servidor). Requiere OAuth con permiso de subida |
| Imágenes / Vídeo / Voz | Preparado para integración | Necesitan claves de servidor. Voz: ElevenLabs (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, voces de la cuenta seleccionables) con OpenAI TTS como respaldo; efectos de sonido con ElevenLabs en Música y sonidos. Google Flow sin API pública oficial confirmada |
| Analytics | Parcial | Conexión OAuth del canal (solo lectura; tokens cifrados AES-256-GCM en `channel_connections`) e importación de YouTube Analytics v2 a `metric_snapshots`: serie diaria del canal y vídeos principales. Requiere `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY` |
| Miniaturas | Preparado para integración | Variantes 16:9 por proyecto con el proveedor de imágenes (`OPENAI_API_KEY`), guardadas como assets `thumbnail`; selección de la definitiva |
| Radar | Parcial | Tendencias oficiales de YouTube (`chart=mostPopular`) por país y categoría, ~2 unidades de cuota por consulta; términos recurrentes calculados sobre los títulos; guardar como oportunidad. Sin histórico todavía |
| Música y sonidos | Funcional | Subida de música y efectos propios, con licencia o de dominio público al almacenamiento privado, con licencia, enlace de origen, duración y ambiente registrados. Sin proveedor de música generativa |
| Editor de vídeo | Funcional | Montaje por escenas del storyboard guardado en `render_jobs.composition`: imagen/vídeo, voz (generable por escena), duración ajustable a la voz, zoom lento, transiciones, música con ducking y subtítulos incrustados. Render en el navegador (canvas + WebAudio + MediaRecorder, WebM ≤ 50 MB) guardado en la Biblioteca con procedencia y licencias de las entradas |
| Shorts / Reels / TikTok | Funcional | Deriva una versión 9:16 de un montaje del Editor: selección de escenas, reencuadre horizontal por escena, hook en pantalla (prellenado con el hook del guion), subtítulos y comprobación de límites (Shorts 3 min, Reels 90 s, TikTok 10 min). Renderiza con el mismo motor; no publica |
| Automatizaciones | Parcial | Vigilancia de tendencias (país, categoría, palabras clave, guardado sin duplicados) y actualización de métricas de oportunidades de YouTube con historial y crecimiento. Ejecución manual; la diaria (Vercel Cron 07:00 UTC, `/api/cron/automations`) requiere `CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY`. Solo leen fuentes y escriben en el workspace: nunca publican |

## Migraciones

- `20260926120000_scripts_module.sql` (aditiva): crea `public.scripts` con RLS y añade `storyboards.script_id`. Aplicada en la base desplegada (versión `20260926151554`); esquema, RLS y flujo guion → versión → storyboard → escenas verificados con transacciones revertidas.
- `20260926190000_automations.sql` (aditiva): crea `public.automations` y `public.automation_runs` con RLS por propietario. Aplicada en la base desplegada; RLS verificado con transacción revertida.
- Aviso: los archivos `20260916*` del repositorio no reflejan exactamente el esquema desplegado (p. ej. `scenes.narration`, `metric_snapshots.observed`, `assets.asset_type`). El esquema desplegado es la referencia; `lib/types/database.ts` sigue al desplegado.
