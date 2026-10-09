# Fábrica de Shorts de curiosidades · Umbral del Hito

Automatización de Cerebro Studio que prepara **1 Short al día** en servidor. Jesús revisa y aprueba cada Short (modo A). Nada se publica sin su aprobación.

Pantallas: `/automations/shorts` (panel) y `/automations/shorts/[id]` (aprobación).

## Reglas aprobadas y dónde se aplican

| Regla | Implementación |
|---|---|
| **Tema con interés comprobado** (vídeos similares, mediana del nicho, tendencia) | `lib/shorts/radar.ts` lee/guarda datos **observados** (YouTube Data API) en `opportunities.observed_metrics`; `evaluateInterest` en `lib/shorts/gates.ts` exige ≥5 vídeos similares, mediana similar ≥ mediana del nicho y tendencia no a la baja. Sin datos → no hay Short. |
| **Dato verificable con ≥2 fuentes fiables** | `lib/shorts/sources.ts`: se descarga cada URL, el modelo debe dar una cita y el **código comprueba que aparece literalmente** en la página. Dominios fiables y distintos (lista en `DEFAULT_CONFIG.reliableDomains`). Si no hay 2, el tema se descarta (y la oportunidad pasa a `discarded`). |
| **Encaje con el canal y con lo que mejor funcionó** | Encaje: puntuación 0-10 de Gemini (**inferido**). Histórico: retención media observada por categoría, solo con ≥2 Shorts con muestra suficiente. |
| **Sin repetir temas** | `topic_key` normalizado + solapamiento de palabras (Jaccard ≥ 0,6) + índice único en BD. |
| **Hook y dato principal en los primeros 2 s** | Controles previos: hook ≤7 palabras, contiene el dato clave, y se **mide con la voz real generada** (caracteres/seg). En vídeo, el hook con el dato resaltado está en pantalla desde el fotograma 0. Se revalida en servidor al aprobar. |
| **Fuentes visibles en la pantalla de aprobación** | Cada fuente con dominio, enlace y la cita literal; no se puede aprobar sin marcar que se han revisado. |
| **Métrica principal: retención media a 7 días** | `lib/shorts/metrics.ts`: `averageViewPercentage` de YouTube Analytics, guardado en `metric_snapshots.observed` (**observado**); lo derivado va en `calculated` (**inferido**). Alimenta la puntuación de temas futuros. |
| **Solo gratis** | Gemini free tier (texto, verificación, voz) y Cloudflare Workers AI (imagen). Un 429/cuota agotada o una calidad mínima no alcanzada ⇒ **ese día no se crea Short** (queda registrado el motivo). Nunca se cambia a un proveedor de pago. |
| **Aprobación y subida** | Aprobación registrada con la sesión de Jesús (`approvals`, `publication_jobs`). La subida es **privada** con `containsSyntheticMedia: true`; el servidor revalida la aprobación (`assertShortApproved`). Hacerlo público es manual en YouTube Studio. |

## Flujo

1. **Cron diario** (`/api/cron/shorts-daily`, 05:30 UTC) o botón «Preparar Short de hoy»: tema → hechos y fuentes → guion → voz → imágenes → manifiesto 9:16 con subtítulos. Todo queda en `shorts` + bucket privado `shorts-assets`.
2. **Al abrir la pantalla de aprobación** el navegador renderiza el vídeo (canvas 1080×1920 + voz + música procedural → MediaRecorder). MP4 si el navegador lo soporta (Chrome/Edge/Safari recientes), si no WebM. Se graba en tiempo real: ~35 s con la pestaña visible.
3. Jesús revisa controles, fuentes y vídeo, marca las dos confirmaciones y **aprueba** (o rechaza).
4. «Subir como privado»: el servidor abre una subida reanudable (el token no sale del servidor) y el navegador sube el archivo directamente a YouTube; el servidor verifica que el vídeo quedó privado.
5. **Cron de métricas** (`/api/cron/shorts-metrics`, 09:15 UTC): cuando el vídeo es público y su ventana de 7 días lleva cerrada ≥2 días, guarda la retención media.

### Música libre
Se **genera en el navegador** (Web Audio, acordes sintéticos). No hay material de terceros, así que no hay licencia que atribuir; queda anotado en el manifiesto.

## Variables de entorno (servidor, Vercel)

Bloquean la preparación del Short:

| Variable | Para qué |
|---|---|
| `GEMINI_API_KEY` | Gemini free tier: temas, guion, verificación, voz |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Workers AI (imágenes). Token con permiso *Workers AI* |
| `YOUTUBE_API_KEY` | Datos de interés (vídeos similares / mediana del nicho) |
| `SUPABASE_SERVICE_ROLE_KEY` | Preparar sin sesión (cron y botón) |
| `CRON_SECRET` | Autoriza Vercel Cron |
| `SHORTS_OWNER_ID` | UUID de Jesús en `auth.users` (propietario de los Shorts del cron) |

Necesarias para subir y medir (mismas que el flujo OAuth de YouTube existente):

| Variable | Para qué |
|---|---|
| `TOKEN_ENCRYPTION_KEY` | Descifrar `channel_connections.token_ciphertext` (formato `v1.iv.tag.datos`, AES-256-GCM) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Refrescar el acceso |

Opcionales: `GEMINI_TEXT_MODEL` (def. `gemini-3.8-flash`, con respaldo automático), `GEMINI_TTS_MODEL` (def. `gemini-2.5-flash-preview-tts`), `CLOUDFLARE_IMAGE_MODEL` (def. `@cf/black-forest-labs/flux-1-schnell`).

Además: **aplicar la migración** `supabase/migrations/20261009090000_shorts_factory.sql` y tener YouTube conectado con permiso de publicación (`youtube.upload` + `yt-analytics.readonly`).

## Supuestos y límites conocidos

- **Tiempos de subtítulos y de escena**: se reparten por número de caracteres sobre la duración real de la voz (inferido, no alineado palabra a palabra).
- **Retención**: mientras el vídeo esté privado no hay audiencia; la ventana de 7 días empieza en `snippet.publishedAt` cuando ya es público. Con <30 vistas se guarda pero no se usa para priorizar.
- **Cuota de YouTube Data API**: cada candidato nuevo cuesta ~101 unidades (de 10 000/día); la mediana del nicho se cachea 7 días.
- **Gemini free tier cambia sin aviso**: si deja de ofrecer un modelo o baja la cuota, ese día no hay Short. No hay *grounding* con Google Search porque agota la cuota gratuita; las fuentes se verifican descargándolas.
- El render exige pestaña visible y un navegador con `MediaRecorder`.
- `lib/publication/guard.ts` asume una columna `action_key` que no existe en el esquema desplegado de `approvals`; los Shorts usan `entity_type='short'`/`entity_id` (`lib/shorts/approval.ts`).
- El OAuth/cifrado vive también en la rama `claude/happy-albattani-qthwrp` (`lib/oauth/google.ts`, `lib/security/tokens.ts`); `lib/shorts/youtube.ts` implementa el mismo formato para no depender de ella. Al fusionar conviene consolidar.

## Pruebas

`npm test` (vitest): reglas de interés/fuentes/hook, aprobación, pipeline completo con BD y servicios simulados (camino feliz y cada descarte), verificación de fuentes (cita literal, SSRF), cifrado de tokens y petición de subida privada.
