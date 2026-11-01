# Informe P4.8 — Candidato de beta privada (solo local)

Presupuesto: 0 €. Sin push, deploy, migraciones remotas, proyectos externos, gasto, publicación, ni cambios en Production, credenciales, variables de Vercel, cron o automatizaciones. No se ha consultado Production en esta fase.

## 1. Funcionalidades incluidas (alcance congelado)

Inicio de sesión · creación y recuperación de proyectos · guiones · storyboards y escenas · importación de materiales (biblioteca y Centro de importación del Editor, subida resumable) · Editor de vídeo (`/editor`, `/editor/manual`) · música y audio (`/audio`, música de fondo, importar audio) · exportación MP4 **solo por la ruta rápida y exacta** · Biblioteca · uso de almacenamiento (`/storage`) · recuperación tras cerrar sesión. No se ha añadido ninguna funcionalidad nueva.

## 2. Funcionalidades desactivadas

El alcance está en `lib/beta-scope.ts` y se **activa con `NEXT_PUBLIC_CEREBRO_BETA=private`** (apagado por defecto: Production no cambia hasta que un despliegue revisado lo decida). Con él encendido, el servidor (`proxy.ts`, antes de la autenticación y sin depender de la interfaz) hace esto:

- **Páginas fuera de alcance** → redirigen a `/?beta=fuera-de-alcance`: estudio de creación y generación (`/studio`, `/images`, `/videos`, `/voices`, `/thumbnails`), Shorts/Reels (`/repurpose`, `/shorts`), investigación/radar/oportunidades/analytics, YouTube, Instagram/TikTok, campañas, calendario, flujos, automatizaciones, conectores, Virtual Influencer, costes, `/add` (atajos iOS), `/queue`, y en el editor: `/editor/auto`, `/editor/style`, `/editor/templates`.
- **API**: solo 4 rutas abiertas (`assets/[id]/signed-url`, `storage/usage`, `storage/upload-url`, `providers/status`); todas son lectura o del propio usuario y la política de rutas ya las marcaba como seguras. **Cualquier otra ruta `/api/*` responde 404 `{blocked:'beta'}`** (generación y proveedores de pago, asistencia IA de guion, transcripción, publicación, OAuth, cron, cola, `render/ticket`, investigación…). Una página o ruta nueva queda cerrada por defecto.
- El menú y las tarjetas de inicio muestran solo los módulos en alcance.
- Dentro de las páginas abiertas, los botones que dependen de rutas cerradas (p. ej. «Proponer hooks», transcripción) devuelven el aviso de función desactivada; no gastan nada.
- **Exportación en tiempo real desactivada** (`lib/editor/export-policy.ts`, `REALTIME_EXPORT_ENABLED=false`): el selector «Modo de exportación» queda fijo en «Rápida» y sin la opción de tiempo real; un proyecto guardado con `mode:'realtime'` se exporta en rápido; si la ruta rápida no puede (códec, archivo ilegible…) la exportación **falla con el motivo y sin guardar nada**, ya no cae en silencio al modo grabado; el botón de exportar ya no exige `MediaRecorder`. El código del tiempo real, el medidor de fidelidad y sus pruebas se conservan. No existe parámetro de URL ni otra ruta que seleccione ese modo (`renderComposition` se llama en un único lugar; ninguna otra página graba el canvas: test estático).

## 3. Configuración aislada y guardas de arranque

`lib/security/beta-config.ts` + `instrumentation.ts`: con la beta encendida, **el servidor no arranca (sale con código 1, no sirve peticiones)** si: `NEXT_PUBLIC_SUPABASE_URL` apunta al proyecto de Production (`psbvqdaksrfrkxbewrll`) o no se puede verificar que sea un `*.supabase.co`/local; la clave publicable es una clave legacy emitida por Production; `VERCEL_ENV=production`; falta URL o clave; o está definida alguna clave de **proveedor de pago** (FAL, OpenAI×3, Gemini, ElevenLabs, DashScope, Higgsfield×2, TopMediaAI, gateway de texto, Groq, Cloudflare) o **privilegiada** (service role, `CRON_SECRET`, cifrado de tokens, sello de publicación, secretos OAuth de Google/Instagram/TikTok, claves R2). El mensaje nombra las variables, nunca los valores. Un test comprueba que ninguna variable con aspecto de secreto leída por el código quede sin clasificar (encontró y corrigió las claves R2).

Uso previo a cualquier despliegue (no lee Vercel, solo un fichero que tú indiques): `node --env-file=<fichero con las variables planeadas> scripts/check-beta-config.mjs`. No se ha tocado ninguna variable real de Vercel.

## 4. Revisión del candidato de despliegue

**Commits locales sin publicar: 17 sobre `origin/fase1-seguridad`** (16 anteriores + P4.7) + el de P4.8 = 18. En total 121 archivos, ~3 900 líneas añadidas (37 rutas de API con guarda de Preview, 6 de esquema, 5 de Editor, tests y scripts). Principales bloques: P4.4 protección de Preview en 36 rutas (`previewBlock`, clave de servicio inexistente en Preview, política de rutas); P4.5–P4.6 baseline de esquema, deriva y estabilidad del worker de análisis; P4.7 E2E del Editor, medidor de fidelidad; P4.8 alcance de beta, política de exportación y guardas de configuración. No hay dependencias npm nuevas.

| Necesidad | Detalle |
|---|---|
| **Migraciones** (solo en el proyecto nuevo, nunca en Production) | `baseline_live.sql` (referencia de estructura) + 7 pendientes en orden: job_queue → storyboard_from_script_rpc → scenes_concurrency_and_reorder → subtitle_unique_per_source → transcription_locks → reserve_generation_spend → research_functions_search_path. Cada una con rollback probado. Además, a mano: el disparador `on_auth_user_created` sobre `auth.users` (esquema gestionado por Supabase; el baseline no lo crea) |
| **Variables requeridas** (alcance Preview) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del proyecto nuevo y `NEXT_PUBLIC_CEREBRO_BETA=private`. Esta última se incrusta **al compilar**: la beta necesita su propio build |
| **Variables que NO deben existir** | todas las de la lista de la sección 3 |
| **Dependencias externas** | un proyecto Supabase independiente (Auth con correo/contraseña; Storage con bucket privado `generated-assets`, políticas por carpeta de usuario, subida resumable activada y límite por archivo ≥ 50 MB), Vercel (Preview), navegador basado en Chromium |
| **Riesgos de incompatibilidad** | (1) Auth y Storage reales no probados (en local son simulados); confirmación de correo, límites de tasa y RLS de `storage.objects` pueden comportarse distinto. (2) `proxy.ts` ahora se ejecuta en todas las rutas (pasa sin tocar las que antes no pasaban); riesgo bajo, cubierto por el E2E. (3) `instrumentation.ts` solo actúa con la beta encendida. (4) Las 3 migraciones de Production ausentes del repo no se han recuperado: el baseline reproduce su efecto estructural, no su texto. (5) Safari/Firefox no validados. (6) Límite de 50 MB por archivo en el plan gratuito de Supabase |
| **Reversión** | Beta: borrar las variables de Preview y el despliegue de Preview (sin efecto en Production); proyecto Supabase nuevo: pausar o borrar (sin coste); esquema: rollback de cada pendiente en orden inverso. Código: los commits siguen locales; basta no publicarlos o `git revert` del rango |

## 5. Validación final (serie; Chromium por separado)

**Pasan**: TypeScript · Vitest **1624 correctas** (161 archivos; +22 de P4.8: política de exportación y alcance/guardas) · build limpio · PostgreSQL 64/64 · PostgREST real sobre el baseline 38/38 · instantáneas sin datos ni secretos · deriva baseline = Production · 7 pendientes 30/30 · migraciones/concurrencia · trayecto de datos 35/35 · UI con login real 11/11 · **E2E audiovisual del Editor 21/21 con la beta encendida** (los 19 de P4.7 + alcance cerrado + rechazo de arranque con configuración de Production y claves de pago/privilegiadas) · FFmpeg/FFprobe dentro del E2E.
**Chromium**: **705/705** en la tercera ejecución (las 704 de antes + la nueva comprobación del selector bloqueado). Transparencia: las dos primeras ejecuciones de esta fase abortaron; la primera por mi arnés (la variable nueva `NEXT_PUBLIC_CEREBRO_BETA` faltaba en la definición del empaquetado: corregido) y la segunda por un fallo transitorio en el primer test del renderizador (`fadeEdge` indefinido, sin relación con los cambios y no reproducido en la tercera). Queda como intermitencia **no explicada**; no se presenta la suite como estable.
**Fallan**: ninguna comprobación determinista. **Omitidas**: 22 tests de Vitest (5 archivos). **No ejecutadas ni declaradas aprobadas**: Auth/Storage/Realtime reales de Supabase (sustitutos locales), Safari/Firefox, Drive/Dropbox/carpeta, generación con IA y proveedores de pago (desactivados), carga con muchos usuarios, build y despliegue en Vercel.

## 6. Riesgos pendientes

1. Auth y Storage reales sin probar (principal condición antes de llamar «lista» a la beta). 2. Las variables de Supabase y claves de pago/privilegiadas siguen compartidas entre Production y Preview en Vercel; la guarda de arranque lo detectaría, pero **hay que separarlas antes de desplegar**. 3. ESLint: 2 errores (flujo Drive/autoarranque de `render-panel.tsx`), no tocados por no haber pruebas de comportamiento. 4. La suite Chromium es intermitente en esta VM de 2 CPU (ver §5). 5. Las 3 migraciones faltantes en el repo. 6. El tiempo real queda desactivado, no eliminado: reactivarlo exige una decisión y las pruebas de fidelidad.

## 7. Estado de los commits

18 locales sin publicar (17 previos + P4.8); `origin/fase1-seguridad` no se ha tocado; no hay cambios sin commitear tras el commit de esta fase.

## 8. Requisitos de infraestructura y costes

Un proyecto Supabase independiente (el cupo gratuito de 2 proyectos activos parece agotado por Cerebro Studio y Gamemur; **no verificado**: lo confirma Jesús en el panel). Sin proveedores de IA, sin publicación, sin cron. Vercel Preview (plan existente). Coste esperado: 0 € **si** el plan es Free y hay cupo; si no, el proyecto adicional puede costar. Alternativa sin coste ni proyecto externo: el stack oficial local de Supabase (Docker) en el PC de Jesús para validar Auth/Storage reales antes de nada.

## 9. Plan de despliegue y reversión (no ejecutado)

1. Decisión de infraestructura (proyecto independiente, o stack local oficial primero). 2. Crear el proyecto; cargar `baseline_live.sql` + 7 pendientes en orden + disparador `auth.users`; comprobar RLS con dos usuarios. 3. `check-beta-config.mjs` sobre el fichero de variables planeadas. 4. Variables de Preview: solo las tres necesarias; retirar de Preview las demás. 5. Push de la rama y deploy de Preview. 6. Repetir `npm run test:e2e:editor` contra el Preview con datos sintéticos. 7. Beta con lista cerrada. Reversión: sección 4.

## 10. Próxima autorización concreta necesaria

Una sola decisión de infraestructura: (a) autorizar el stack local oficial de Supabase en el PC de Jesús para validar Auth/Storage reales sin coste (recomendado primero), y/o (b) crear un proyecto Supabase independiente tras confirmar plan y cupo. Después, y por separado: push de la rama y deploy de Preview con variables solo de alcance Preview.
