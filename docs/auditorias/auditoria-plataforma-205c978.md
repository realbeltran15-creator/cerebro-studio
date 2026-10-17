# Cerebro Studio · auditoría de plataforma completa · `205c978` · 17-10-2026

**Método:**
- Revisé el código (repositorio `feat/creation-studio` = `205c978`).
- Ejecuté las pruebas: `vitest` da 808 correctas, 13 omitidas y 1 fallo. El fallo es `vendored-ffmpeg` y se debe a que mi copia no tiene instalado `@ffmpeg/ffmpeg`, no al código. `tsc --noEmit` pasa limpio.
- Recorrí en la Preview las 18 pantallas con tu sesión.
- Hice la prueba real de Investigación de hoy («AI tools for beginners», 204 u y 2 búsquedas; Google Cloud lo confirma: 9/100).

**Sin gastos ni cambios:** no he gastado créditos de IA, no he publicado nada, no he aplicado migraciones ni he tocado Producción.

**Leyenda:**

| Estado | Significado |
|---|---|
| ✅ Operativo | Funciona y está verificado con datos reales |
| 🟡 Parcial | Código real, pero sin verificar o le faltan piezas |
| 🧪 Sin probar | Código real, nunca ejecutado contra el proveedor |
| ❌ No existe | No está hecho |

## 0. Resumen

| Módulo | Estado | Bloqueo principal |
|---|---|---|
| 1. Investigación de mercados | 🟡 casi | Motor 6 con una regresión nueva (R-1); sin persistencia en servidor (`research_cache` sin aplicar) |
| 2. Imagen y vídeo IA | 🧪 | Solo Gemini TTS probado en real. Imagen y Veo de Gemini dan 429 sin facturación; fal, Higgsfield, OpenAI y Alibaba nunca ejecutados |
| 3. Voz, música y efectos | 🟡 | Gemini TTS ✅; ElevenLabs, OpenAI TTS, MeloTTS, TopMediai y Lyria 🧪 |
| 4. Editor manual | ✅ (en navegador) | Render en tiempo real en la pestaña; MP4 compatible solo con `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` |
| 4b. Editor automático | ✅ heurístico | Sin IA (silencios y cambios de plano); subtítulos con tiempos aproximados |
| 5. Fábrica de Shorts | 🟡 | La página está vacía («Todavía no hay Shorts»); el render no es desatendido; no detecta clips en vídeos largos |
| 6. Biblioteca | 🟡 | No permite subir ni borrar; 500 filas sin paginación; cuota inexacta |
| 7. Personajes virtuales | 🟡 / ❌ | Solo referencias de imagen; fal e Higgsfield las descartan sin avisar; avatares, lip-sync e influencer IA no existen |
| 8. Automatizaciones | 🟡 | El cron funciona; ejecuciones «running» huérfanas; coste fijo `spendUsd: 0` |
| 9. YouTube | 🟡 | OAuth ✅ (canal «Umbral del Hito»); subida privada con doble aprobación sin verificar en real; programación ❌ |
| 9b. Instagram y TikTok | 🧪 | Faltan `INSTAGRAM_APP_*` y `TIKTOK_CLIENT_*`, y las apps aprobadas por Meta y TikTok |
| 10. Analítica | 🟡 | Analytics del canal conectado pero nunca importado (la portada muestra «Sin datos observados») |
| 11. Proveedores, créditos y costes | 🟡 | Confirmación de coste ✅; sin tope de gasto en USD por usuario o mes; `/usage` es una estimación |
| 12. Seguridad y estabilidad | 🔴 | Migraciones ≠ esquema real (P0); aprobación de publicación falsificable por RLS (P1) |
| Campañas | 🟡 | Solo `localStorage`; su migración está «PREPARED, NOT APPLIED» |

**La portada promete más de lo que hay.** Marca «Funcional» en Estudio IA, Música/SFX y Convertir a Shorts, pero la mayoría de sus modelos nunca se han ejecutado en real. Debería mostrar «Sin probar» según `catalog.ts` (`evidence`).

## 1. Investigación: cierre de las cinco correcciones de `205c978`

El motor 6 está desplegado: el texto «HIPÓTESIS» aparece en el bundle de la Preview. Comprobé cada corrección sin cuota, repitiendo los casos reales sobre el código actual:

| # | Corrección | Resultado |
|---|---|---|
| 1 | Ingresos sin multiplicador por país | ✅ Para 1.817.583 vistas en el nicho `ia`, el RPM pasa a 4–25 (antes 7,7–48). El rango queda en $7.270–$45.440 con confianza «muy baja» y `verified:false` |
| 2 | Regla de herramientas de IA | ✅ «FULL Claude Tutorial…», «Ultimate Beginner's Guide to Claude AI» y «Google AI Studio Tutorial» se aceptan; «Claude Monet painting» queda fuera. **Pero ver R-1** |
| 3 | Fiabilidad de la demanda | ✅ En las pruebas: concentración, número de canales y peso de los Shorts reducen el índice |
| 4 | Oferta con tracción (≥100 vistas) | ✅ En las pruebas |
| 5 | Sesión caducada | ✅ En las pruebas: «opaqueredirect» se trata como sesión caducada. No probado en real porque requiere que caduque la cookie |

También funcionan los casos de vivienda en EE. UU.: «America's typical first-time home buyer…» y «HGTV vs. REALITY: Home Buying…» se aceptan, y «Best first car to buy» se descarta.

### R-1 (P1, regresión nueva del motor 6) · cualquier vídeo con «AI» se acepta en «AI tools…»

Reproducción sin cuota con `assessVideo(v, queryProfile('AI tools for beginners'), ['en'], {region:'US'})`:
- «Earning money with Ai !» → **aceptado**, 75 %, «confirmado por vocabulario de herramientas de IA: ai».
- «What is AI? explained» → **aceptado**.

En la muestra real de hoy, «Earning money with Ai !» es un Short con **46,7 M de vistas**. Con el motor 6 entraría en la demanda y la dominaría.

**Causa:** la regla `ia-herramientas` (`lib/research/relevance.ts:281`) cuenta el propio término `ai` como prueba de «herramienta».

**Corrección:** la palabra genérica `ai` o `ia` no puede cubrir `tools`. Solo un **nombre de herramienta** (ChatGPT, Claude, Gemini, Copilot…) o una frase como «ai tool(s)», «ai app(s)» o «ai software» cubre el término.

**Prueba de regresión:** esos dos títulos → descartados o dudosos; «FULL Claude Tutorial for Beginners» → aceptado.

### Lo que falta para dar Investigación por cerrada

1. Corregir R-1.
2. Una única prueba real con el motor 6: repetir «AI tools for beginners» · US (204 u y 2 búsquedas). **Necesita tu autorización**, porque los 9 análisis guardados son de motores 3–5 y no se pueden recalcular gratis.
3. Aplicar `research_cache` (**necesita tu autorización**) para que el contador y la caché sobrevivan a los despliegues y se compartan entre dispositivos.
4. Arreglar los textos que quedan: el plan guiado aún dice «YouTube concede 10.000 al día».

## 2. Estudio de creación: imagen, vídeo, voz, música y efectos

- **Flujo:** página → `POST /api/studio/generate` → `startGeneration`.
  - Los resultados inmediatos se guardan en el bucket `generated-assets` y en la tabla `assets`.
  - Los trabajos en cola se consultan cada 5 s.
- **Confirmación de coste:** el servidor exige `confirmedEstimateUsd` en los modelos de pago y nunca pasa solo a uno de pago.
- **Recuento en pantalla** (`/studio`): Imagen 13/14, Vídeo 6/9, Voz 3/5, Música 1/2, Efectos 0/1, Ambientes 0/1 modelos «configurados». Configurado no significa probado.

**Bloqueos:**
- **E-1 (P1). Los trabajos en cola no tienen tabla en Supabase.** Solo están en `localStorage` (`app/studio/page.tsx:54-61`). Si se borra el navegador, el proveedor cobra y el resultado se pierde. Los cupos gratuitos no cuentan los trabajos en curso.
- **E-2 (P1). No hay tope de gasto en USD por usuario, día o mes.** La confirmación compara la estimación que manda el propio navegador. Higgsfield y ElevenLabs tienen precio «no publicado» y estiman $0.
- **E-3 (P2). Verificación real pendiente**, modelo por modelo. Propongo una batería mínima con el modelo más barato de cada tipo (1 imagen, 1 vídeo corto, 1 voz, 1 música, 1 efecto), con tope en USD y **con tu autorización**.
- **E-4 (P2). Personajes:** fal e Higgsfield descartan las referencias sin avisar (`adapters/index.ts:47,52`). No hay ficha de personaje, ni imagen→vídeo, ni avatares, ni lip-sync.

## 3. Editores, plantillas y exportaciones

- **Editor manual ✅:** línea de tiempo completa, guardado con control de conflictos, render con canvas + MediaRecorder y guardado en `assets`, en R2 o Supabase.
  - Límites: render en tiempo real con la pestaña visible; 50 MB por archivo en Supabase; MP4 H.264 solo con ffmpeg.wasm configurado.
- **Editor automático ✅** con reglas, sin IA: silencios, cambios de plano y transcripción con Groq o Cloudflare.
- **❌ Plantillas.** No existen.
- **❌ Exportar SRT/VTT** junto al render: solo hay subtítulos incrustados, con tiempos aproximados.
- **❌ Render en servidor y en lote.**

## 4. Biblioteca y automatizaciones

- **Biblioteca:**
  - ✅ Listado, filtros, ficha de procedencia y URL firmada.
  - ❌ Subir y borrar desde `/library`, aunque el aviso de cuota pide «Borra archivos… en la Biblioteca».
  - Sin paginación pasadas 500 filas; la cuota no cuenta los recursos generados en el servidor sin `bytes`.
- **Automatizaciones:**
  - ✅ Cron diario protegido con `CRON_SECRET`; tres tipos de trabajo; nunca publican.
  - 🟡 Sin rescate de ejecuciones `running` huérfanas; `last_run_at` se actualiza aunque fallen; `spendUsd: 0` fijo.

## 5. Publicación y distribución

- **YouTube:**
  - ✅ OAuth (tokens AES-256-GCM, nonce, renovación).
  - ✅ Doble aprobación («APROBAR» + publicar), privado por defecto.
  - ❌ Programación (`publishAt`).
  - Sin reanudación de subidas.
  - Trabajos atascados en `publishing`.
- **Instagram y TikTok 🧪:**
  - Código completo, pero faltan credenciales y las apps aprobadas por Meta y TikTok.
  - **En Instagram el Reel queda público al publicar**, porque no existe modo privado. La interfaz debería avisarlo.
- **Nunca se publica solo:** comprobado; ningún cron llama a `publishJob`.

## 6. Seguridad y estabilidad

- **P0-1. Las migraciones del repositorio no reconstruyen la base real.** Comprobado en `README.md:133`.
  - El código usa `assets.asset_type/provenance`, `render_jobs.composition/output_asset_id`, `channel_connections.provider/token_ciphertext`, `publication_jobs.result/approved_by`, `approvals.entity_type/entity_id`, `metric_snapshots.platform/metric_date`, `projects.target_platforms`… Ninguna migración las crea.
  - Corrección: `supabase db dump --schema public` del proyecto real y una migración «baseline». **Solo lectura; la decides tú.**
- **P1-1. La aprobación de una publicación se puede falsificar desde el navegador.** `approvals_owner_all` y `publication_jobs_owner_all` son `for all` (`production_workflow…sql:86`, `initial…sql:126`, verificado). Con la sesión del propio dueño o mediante un XSS se puede marcar `approved` sin escribir APROBAR ni pasar la comprobación de licencias.
  - Corrección: limitar las escrituras de `status` a funciones RPC `security definer` o a un trigger.
- **P1-2. La aprobación no está atada al contenido.** Se puede cambiar `payload.privacyStatus` a `public` después de aprobar.
  - Corrección: guardar un hash del payload en la aprobación.
- **P2-1.** `proxy.ts:41` no incluye `/social`, `/connectors`, `/campaigns` ni `/shorts`. La interfaz se ve sin sesión; los datos siguen protegidos por RLS.
- **P2-2.** Ninguna ruta que gasta tiene límite de peticiones.
- **P3.**
  - `/api/providers/status` no tiene autenticación.
  - `next`, `@supabase/*` están en `latest`.
  - No hay CSP ni cabeceras de seguridad.
  - La clave de cifrado de tokens no se puede rotar.
- **Correcto:**
  - No hay secretos con `NEXT_PUBLIC_`.
  - La service role solo se usa en el cron.
  - Todas las tablas tienen RLS.
  - 38 de 39 rutas comprueban la sesión.

## 7. Plan de cierre por fases

Code ejecuta en `feat/creation-studio`; yo verifico en la Preview después de cada fase.

| Fase | Trabajo (código) | Verificación | Requiere tu permiso |
|---|---|---|---|
| 1 Investigación | R-1, textos | 1 análisis real | Sí: 204 u y 2 búsquedas; aplicar `research_cache` |
| 2 Estudio | Tabla de trabajos IA, tope de gasto USD, avisos de referencias, «Sin probar» en la portada | Batería mínima de 5 generaciones con tope | Sí: gasto de créditos con tope |
| 3 Editores | Exportar SRT/VTT, plantillas básicas (3 formatos), ffmpeg configurado | Render 9:16 real en la Preview | Variable `NEXT_PUBLIC_FFMPEG_CORE_BASE_URL` |
| 4 Biblioteca y automatizaciones | Subir y borrar en la Biblioteca, paginación, rescate de ejecuciones huérfanas | Subir, borrar y ejecutar manualmente | Borrar datos reales: solo de prueba |
| 5 Publicación | RPC o trigger de aprobación con hash, aviso de Instagram público, `publishAt`, reintento de atascados | Subida **privada** de prueba a YouTube | Sí, explícito |
| 6 Integración y seguridad | Migración baseline, rutas en `proxy.ts`, límite de peticiones, auth en `providers/status`, fijar versiones | e2e del flujo idea → guion → medios → montaje → subida privada | Sí: migraciones |

## 8. Entrega a Claude Code

Code no ha podido leer los informes anteriores: no estaban en el repositorio, ni en el disco, ni en Drive.

Esta auditoría va en un parche para `docs/auditorias/`, que hay que aplicar a mano. También se intentará subir a Google Drive, y la ubicación se indicará solo si queda comprobada.
