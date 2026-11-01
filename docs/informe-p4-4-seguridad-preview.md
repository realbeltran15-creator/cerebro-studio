# P4.4 — Aislamiento de Preview y auditoría de rutas sensibles
Rama `fase1-seguridad` (local, sin push) · 0 € · Sin cambios en Vercel, Supabase, variables, cron ni credenciales.

## 1. Inventario de rutas (63 rutas API en `app/api`)
Cada ruta tiene una decisión en `lib/security/route-policy.ts`; el test `tests/preview-guard.test.ts` falla si aparece una ruta nueva sin decisión.
| Categoría | Rutas bloqueadas en Preview | Qué impide |
|---|---|---|
| `paid-provider` (13) | studio/generate, studio/job, studio/enhance, studio/catalog, providers/check, providers/render, providers/sfx, providers/voices, influencer/jobs/[jobId]/run, scripts/assist, recreate/analyze, shorts/demo, transcribe (POST) | uso de FAL, OpenAI, Gemini, ElevenLabs, DashScope, TopMediaAI… |
| `publication` (5) | publish/youtube/[jobId]/approve · publish · verify; publish/social/[jobId]/approve · publish | aprobar y publicar en YouTube/Instagram/TikTok |
| `automation` (2) | cron/automations, automations/[id]/run | tareas programadas y manuales (trend_watch, shorts_factory…) |
| `privileged` (14) | ios/start, ios/finish, ios/token, meta/data-deletion (+deauthorize), oauth/[platform]/start·callback·disconnect, oauth/youtube/start·callback·confirm·disconnect·pending, analytics/youtube/import, social/tiktok/creator | cuentas conectadas, tokens OAuth cifrados y clave de servicio |
| `destructive` (2) | storage/cleanup, storage/object (DELETE) | borrado de archivos reales |
Total: **36 rutas, 39 manejadores protegidos**; 27 rutas quedan abiertas, cada una con su razón (lectura propia con RLS, cuota gratuita de YouTube Data, bancos de recursos gratuitos, cola 4B desactivada por defecto…).

## 2. Protección implementada (servidor)
- `lib/security/preview-guard.ts`: `deployEnv()` decide solo por `VERCEL_ENV` (variable de servidor de Vercel, no pública, no modificable desde el navegador). `previewBlock(kind)` devuelve 403 `{blocked:'preview'}` sin caché.
- Cada manejador sensible lo llama **como primera instrucción**: antes de autenticar, de leer el cuerpo y de cualquier llamada externa. No hay interruptor para saltárselo (permitir algo en Preview exige un commit revisado).
- `serviceRoleClient()` devuelve `null` en Preview: aunque la clave de servicio exista en el entorno Preview, el código no la usa (las rutas que la necesitan ya están bloqueadas; el resto usa la sesión del usuario y su RLS).
- Topes de gasto: en Preview valen 0 salvo valores explícitos (cambio de P4.3).
- Production y desarrollo local: sin cambios (`production` y sin `VERCEL_ENV` pasan).
- Refactor mínimo: `refreshOpportunityMetrics` pasa a `lib/automations/refresh-metrics.ts` (misma lógica, re-exportada) para que la ruta abierta `opportunities/refresh` no importe el ejecutor de automatizaciones, que alcanza a los proveedores de IA.

## 3. Pruebas (86 en `tests/preview-guard.test.ts`, todas pasan)
- 39 manejadores × 2: en Preview responden 403 con una sesión autenticada simulada disponible, **sin tocar la sesión/BD ni la red** (el `fetch` simulado lanza si se usa); en Production el guard no se activa (la respuesta no es el bloqueo de Preview).
- Cobertura: toda ruta tiene decisión; cada manejador bloqueado llama a `previewBlock` con su tipo como primera instrucción; ningún manejador de una ruta «todo bloqueado» queda sin guard.
- Alcance transitivo: ninguna ruta abierta importa (directa o indirectamente) módulos de proveedores de pago, publicación o Drive. Esta prueba detectó `opportunities/refresh` (arreglado con el refactor).
- Las propias pruebas se comprobaron por mutación: quitar el guard de `studio/generate` o añadir una ruta sin decisión hace fallar la suite.

## 4. Datos reales y credenciales privilegiadas
- Rutas con clave de servicio revisadas: ios/start·finish (código de atajo con hash → propietario; ruta y cuota por propietario), oauth callback/disconnect (usuario de sesión + estado/nonce; consultas filtradas por `owner_id`), oauth/youtube/confirm (sesión), meta/data-deletion (`signed_request` firmado con HMAC; rechaza si falta `INSTAGRAM_APP_SECRET`), cron (portador `CRON_SECRET` con comparación en tiempo constante), `publicationWriter`/libro de gasto (llamados tras autenticar). Ninguna acepta un identificador de propietario del cliente.
- ¿Se puede quitar `SUPABASE_SERVICE_ROLE_KEY` de Preview sin romper lo básico? **Sí**: Auth, proyectos, guiones, storyboards, Biblioteca, editor y exportación usan la sesión del usuario con RLS. La clave solo hacía falta para publicación, OAuth, atajo iOS, libro de gasto, cola 4B y cron, todo bloqueado en Preview. Recomendación: quitarla de Preview en Vercel (cambio **no realizado**, requiere autorización).
- Lo que sigue sin protegerse por diseño en Preview: escrituras normales del usuario con su sesión (crear/editar proyectos, guiones, materiales). Están protegidas por RLS y propiedad de ruta, pero **son datos reales**: no se ejecutan pruebas de escritura/borrado/subida/migración desde Preview.

## 5. Entorno aislado de pruebas: qué hay y qué falta
- Ya disponible (gratis, local): PostgreSQL 16, PostgREST 12.2.3 real + `@supabase/postgrest-js`, FFmpeg, Chromium, S3 local (moto) → recorrido de datos autenticado con JWT propios y datos sintéticos (`scripts/test-postgrest-integration.sh`: 38 pruebas).
- Falta para Auth real: GoTrue (Supabase Auth). En este entorno no se puede obtener: Docker sin demonio, acceso a los repositorios de Supabase en GitHub no habilitado y el proxy de módulos de Go inaccesible.
- Falta para Storage real: Supabase Storage API (Node, solo imagen Docker/fuente en GitHub); mismo bloqueo.
- En el PC de Jesús (solo lectura): sin Docker ni Supabase CLI, 3,6 GB de RAM y 7,4 GB libres. Un stack Supabase local completo no es viable allí.
- Opciones realistas para Auth/Storage reales: (a) rama/proyecto Supabase aparte (de pago, descartado), (b) segundo proyecto Supabase gratuito, que es otro recurso externo y requiere autorización expresa de Jesús, (c) seguir sin ellos y verificar Auth/Storage con una sesión real solo con operaciones de lectura.

## 6. Riesgos residuales
1. Preview sigue conectada a la base y al almacenamiento de Production (URL/clave pública compartidas): cualquier escritura normal con una sesión real toca datos reales.
2. Las rutas abiertas de `research/*` y `opportunities/refresh` consumen la **cuota gratuita** compartida de YouTube Data (sin coste, pero compite con Production).
3. Las variables de claves de pago y de OAuth siguen presentes en Preview; hoy el código las ignora, pero la defensa es solo de código hasta que Jesús autorice quitarlas.
4. Cola 4B: desactivada por defecto y con configuración que rechaza Production; no se re-auditó en esta fase.
5. Las protecciones dependen de que Vercel exponga `VERCEL_ENV` (es el valor por defecto). Si faltara, el servidor se comportaría como «local» (sin bloqueo).
6. WCAG, Auth y Storage reales siguen sin verificar (ver informes anteriores).

## 7. Plan seguro de despliegue y reversión
Prerrequisitos para cualquier push: autorización expresa de Jesús. Orden recomendado: (1) quitar de Preview `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`, `OPENAI_*`, `GEMINI_API_KEY`, `YOUTUBE`-OAuth y `CRON_SECRET` y fijar `GENERATION_*_CAP_USD=0` (variables, cada una reversible desde el panel); (2) publicar los commits; (3) comprobar que la Preview devuelve 403 en `/api/studio/generate` y que el inicio/lectura funciona; (4) solo lectura con la cuenta real. Reversión: volver al despliegue `79cfe00` en Vercel; las variables se restauran desde el panel (sus valores no se tocaron); ninguna migración de por medio.

## 8. Acciones que requieren autorización de Jesús
1. Retirar de las variables de Preview las claves de servicio, de pago y de OAuth (opcional pero recomendado) y fijar los topes de gasto a 0.
2. Push de los commits y creación de una Preview.
3. Cualquier prueba de escritura con su cuenta real (no recomendada en Preview).
4. Decidir sobre un segundo proyecto Supabase gratuito para pruebas aisladas.

## 9. Decisión que se presenta
- **Opción A — entorno realmente aislado**: crear un segundo proyecto Supabase gratuito (otra URL, otra clave, sin datos reales) y apuntar a él solo las Previews mediante variables acotadas a la rama. Permite el recorrido completo con Auth y Storage reales sin riesgo para los datos. Coste esperado 0 € si el plan lo permite (no verificado: cuota de proyectos gratuitos de la organización desconocida); requiere autorización y un recurso externo nuevo.
- **Opción B — publicar solo cambios verificables sin tocar datos reales**: subir el código con la Preview ya bloqueada (esta fase), quitar las claves privilegiadas de Preview y limitarse a comprobar lectura y bloqueos con la sesión real; el recorrido de escritura (guardar, subir, exportar y guardar) queda sin verificar.
- Recomendación técnica: **A** si Jesús acepta crear el proyecto gratuito; si no, B con las variables retiradas.

## 10. Validación (resultados reales)
| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | limpio |
| Vitest completo | 158 archivos · 1590 pasan · 22 omitidos (S3 local, solo con su script) · 0 fallos |
| Pruebas de Preview | 86/86 (incluye mutaciones comprobadas a mano y alcance transitivo) |
| Build en entorno limpio | OK |
| ESLint | 12 errores y 121 avisos **preexistentes** (reglas de React Compiler/hooks en `editor-timeline`, `editor-batch` y 2 tests); ninguno en archivos de esta fase; no bloquean el build. Pendiente de limpieza aparte |
| Chromium / PG / PostgREST / S3 local | no re-ejecutados: los cambios de esta fase son solo de servidor y no los afectan (últimos resultados: 704/704, 64/64, 38/38, 7/9) |
