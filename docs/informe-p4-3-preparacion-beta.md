# P4.3 — Preparación de beta privada y validación de despliegue
Fecha: 2026-11-01 · Rama `fase1-seguridad` (solo local) · 0 € · Todo lo de Vercel/Supabase fue **solo lectura**. No se copian valores de secretos.

## 1. Auditoría de configuración (solo lectura)
**Preview = Production de datos. NO es un entorno aislado.**
- Variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` están definidas para *production y preview a la vez* (sin acotar a rama): cada Preview usa el mismo proyecto Supabase de Production (`psbvqdaksrfrkxbewrll`), con su Auth, Storage y base de datos.
- `SUPABASE_SERVICE_ROLE_KEY` existe también en Preview: una Preview puede escribir con privilegios de servicio en Production.
- Datos reales en esa base (solo recuentos): 3 usuarios, 20 proyectos, 98 materiales, 9 guiones, 10 storyboards.
- Claves de proveedores de pago presentes en Preview: `FAL_KEY`, `OPENAI_API_KEY`, `OPENAI_VOICE_API_KEY`, `GEMINI_API_KEY`; también `YOUTUBE_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `CLOUDFLARE_*`. Solo las variables de Google Picker están acotadas a la rama `fase1-seguridad`.
- Ausentes (por tanto esas funciones están inactivas): `R2_*` (el driver de almacenamiento es Supabase Storage), `ELEVENLABS_API_KEY`, `GROQ_API_KEY`, `DASHSCOPE_*`, `HIGGSFIELD_*`, `INSTAGRAM_*`, `TIKTOK_*`, `PEXELS/PIXABAY/FREESOUND`, `GENERATION_DAILY_CAP_USD`/`GENERATION_MONTHLY_CAP_USD` (rigen los topes por defecto), `PUBLICATION_SEAL_KEY` (usa `TOKEN_ENCRYPTION_KEY`).
- Cron: `vercel.json` programa `/api/cron/automations` (07:00 UTC). Según la documentación de Vercel los cron solo se ejecutan en el despliegue de Production; no se ha tocado nada.
- Despliegues: los últimos 20 son Preview de `fase1-seguridad`; el último es `79cfe00` (READY). Ninguno es de Production en esa lista.
- Storage real: bucket `generated-assets` privado, sin límite propio de tamaño ni tipos MIME; 4 políticas (select/insert/update/delete «own») solo para `authenticated`.
- Migraciones aplicadas en Supabase: las 12 del repositorio (hasta `20261018120000_server_owned_security`). **Pendientes (no aplicadas): 7 propuestas** en `supabase/pending/` (`job_queue` y las 6 nuevas, con rollback). La aplicación actual **no depende** de ellas.
- Asesor de seguridad de Supabase: `leaked password protection` desactivada (ajuste del panel, lo decide Jesús); `search_path` mutable en 3 funciones `research_*` (propuesta SQL `20261102170000`, probada en PostgreSQL local, sin aplicar); 3 tablas `ai_memory.*` con RLS y sin políticas (INFO; sin acceso para clientes).

## 2. Plan de despliegue seguro
- Local vs remoto: 13 commits por delante de `origin/fase1-seguridad` (`79cfe00`), solo avance (fast-forward esperado; verificar `git fetch` al subir). 13 commits = 11 de pruebas/informes/arreglos + 1 de «Preview sin pago por defecto» + este informe.
- Estado de pruebas del último commit funcional: tsc limpio, Vitest 1504+ pasan, build OK, Chromium 704/704 (antes del cambio de `spend.ts`, que es solo servidor), PG 64/64, PostgREST 38/38, S3 local 7/9 (2 omitidas declaradas).
- **Riesgo de Preview**: cualquier push crea una Preview que usa la base y el almacenamiento de Production y las claves de pago. Por eso no se considera aislada.
- Mitigación ya hecha en código (sin tocar variables): en Preview (`VERCEL_ENV` ≠ `production`) los topes de generación de pago valen 0 salvo que se definan explícitamente; Production y desarrollo local no cambian. Cubre `POST /api/studio/generate`, que es la única ruta con topes de gasto. Las demás rutas con clave de pago (texto de guiones con Gemini/OpenAI, Influencer IA con su propio presupuesto previo, SFX sin clave) no pasan por esos topes y **no se han re-auditado** aquí.
- No se ha ejecutado push ni despliegue.

## 3. Recorrido real: estado de cada paso
Criterio: «verificado» solo con sistemas reales. En esta fase nada del recorrido se ha ejecutado contra Supabase real, así que ningún paso figura como verificado.
| Paso | Código y pruebas | Dependencias | Estado |
|---|---|---|---|
| Iniciar sesión | cliente Supabase Auth; navegador con mock | Supabase Auth real | Sin verificar (requiere sesión de Jesús) |
| Crear proyecto | Chromium (mock) + RLS en PostgREST | PostgREST/RLS | Verificado en PG/PostgREST reales; UI sin Supabase real |
| Crear y guardar guion | Chromium (mock) + unicidad de versión | RLS | Igual |
| Generar storyboard sin pago | Chromium (mock); la RPC atómica está solo en SQL pendiente | RLS | La pantalla usa dos pasos (con carrera conocida); la RPC no está aplicada |
| Importar materiales | S3 local (7 pasos) + Chromium | Supabase Storage real | Sin verificar con Storage real (límite 50 MB si el plan es Free) |
| Editar escenas y clips | Chromium 704/704 | solo navegador | Verificado en Chromium real (datos simulados) |
| Exportar MP4 | FFmpeg real (E2E) y WebCodecs; conversión local a MP4 sin ejecutar; riesgo realtime abierto | navegador | Parcial |
| Guardar resultado | Storage (ver arriba) | Storage real | Sin verificar |
| Biblioteca | Chromium (mock) + limpieza S3 local | Storage/RLS | Sin verificar con Storage real |
| Cerrar sesión, volver y recuperar | Chromium (mock) | Auth real | Sin verificar |
Guion para ejecutarlo: `docs/guion-prueba-manual-recorrido.md`.

## 4. Bloqueantes locales resueltos en esta fase
Carrera de `create_storyboard_from_script` (SQL pendiente), tope de pago en Preview a 0 por defecto, propuesta de `search_path`. No quedan bloqueantes de código conocidos para el recorrido básico; lo que falta es verificación con infraestructura real.

## 5. Almacenamiento
| Opción | Estado | Coste/riesgo |
|---|---|---|
| Local (navegador/disco de la persona) | usable para editar y exportar | sin coste; no persiste entre dispositivos |
| Supabase Storage (existente) | bucket privado con políticas por propietario; es el driver activo | dentro del plan actual (plan desconocido; Free = 50 MB por archivo, ~1 GB); comparte cuota con Production |
| Cloudflare R2 | no configurado (sin `R2_*`) | crear bucket/cuenta no está autorizado; el código está listo |
| Sustituto S3 (moto) | solo pruebas | no equivale a Supabase Storage ni R2 (permisos, firmas, CORS distintos) |

## 6. Costes potenciales
Generación de pago: apagada en Preview (tope 0 por código) pero las claves existen; en Production rigen 5 USD/día y 25 USD/mes. Supabase: sin cambios; ramas de pago descartadas. Vercel: cada push genera una Preview (uso del plan actual).

## 7. Plan de reversión
Código: `git revert` de los commits o volver al despliegue previo `79cfe00` en Vercel (instantáneo). Base de datos: nada que revertir (no se aplica ninguna migración). Archivos subidos durante la prueba: borrables desde la Biblioteca/Almacenamiento; los proyectos de prueba se pueden borrar con sus cascadas (verificadas en local).

## 8. Acciones que requieren autorización de Jesús
1. Push de los 13 commits a `fase1-seguridad` (crea una Preview conectada a Production).
2. Usar esa Preview con su cuenta real para el recorrido manual.
3. (Opcional, recomendado) Definir `GENERATION_DAILY_CAP_USD=0` y `GENERATION_MONTHLY_CAP_USD=0` solo para Preview: refuerza lo que ya hace el código. Cambio de variable: no realizado.
4. (Opcional) Activar «leaked password protection» en Supabase Auth.
5. Aplicar migraciones pendientes: **no propuesto** para esta beta.
6. Decisión sobre rama Supabase de pago: **descartada** por ahora (presupuesto 0 €).

## 9. Siguiente operación segura propuesta
**Operación**: publicar los 13 commits en `fase1-seguridad` (mismo mecanismo de bundle ya usado) para generar una Preview, y que Jesús ejecute `docs/guion-prueba-manual-recorrido.md` con su cuenta.
**Qué se modifica**: la rama `fase1-seguridad` en GitHub y una nueva Preview de Vercel; nada en Supabase, variables, cron ni credenciales.
**Por qué**: es la única forma de verificar Auth, Storage y el recorrido con sistemas reales sin gastar; el riesgo (la Preview toca datos de Production) se acota con el tope de pago 0 por código, el uso de una sola cuenta y la reversión inmediata al despliegue `79cfe00`.
**Condición**: solo con la autorización expresa de Jesús. Sin ella, el trabajo continúa en local.
