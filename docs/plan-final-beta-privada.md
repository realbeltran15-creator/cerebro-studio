# Plan final de la beta privada (P5.22)

Solo lectura y preparación local. No se han creado proyectos, ni desplegado, ni hecho push, ni aplicado migraciones, ni tocado Production, ni gastado nada. Fecha de las comprobaciones: 6-nov-2026.

## Diagnóstico final: **BLOQUEADA en Supabase hasta que Jesús elija una salida; todo lo demás, PENDIENTE DE AUTORIZACIÓN**

## 1. Supabase (comprobado con la cuenta conectada)

| Hecho | Fuente |
|---|---|
| Una sola organización, plan **free** | `get_organization` |
| 3 proyectos: **Cerebro Studio** (`psbv…`, ACTIVO, Production), **Cazador de Cupones** (ACTIVO), **gamemur** (INACTIVO/pausado) | `list_projects` |
| El plan gratuito permite **2 proyectos gratuitos**, contados entre todas las organizaciones donde eres propietario/administrador; **los pausados no cuentan** | Documentación oficial de Supabase (billing), leída hoy |

Cuadra con los informes anteriores («3 proyectos, uno inactivo»): hay 2 activos + 1 pausado, es decir, **el cupo gratuito está agotado**. Crear un tercer proyecto activo no es posible sin cambiar algo. No se ha intentado crearlo.

Salidas (ninguna aplicada; elige Jesús):
- **A. Cuenta Supabase gratuita nueva con otro correo** (el límite es por propietario): independiente de Production y de los otros negocios, coste 0 €. Requiere crear una cuenta externa → autorización expresa.
- **B. Pausar «Cazador de Cupones»** para liberar un hueco: toca otro negocio (tiene proyecto Vercel `cazador-de-cupones`) y lo dejaría sin base de datos. No recomendado.
- **C. Plan Pro**: gasto mensual → prohibido sin decisión expresa.
- Nunca: usar el proyecto Production ni gamemur para la beta.

No verificado: el estado de la restauración de gamemur y si algún límite adicional (p. ej. proyectos por región) afecta a una cuenta nueva; se comprobaría en el panel antes de crear nada.

## 2. Vercel (comprobado)

- Equipo `jesus-e021` (slug), un único miembro: Jesús (OWNER). 6 proyectos: `cerebro-studio`, `cazador-de-cupones`, `cazador-de-cupones-preview`, `gamemur`, `cerebro-ebay-privacy`, `ai-bridge`. El plan del equipo no figura en la API (no verificado; con un solo miembro se comporta como Hobby).
- `cerebro-studio` está **conectado a GitHub** (`realbeltran15-creator/cerebro-studio`) y **despliega solo cada rama**: los últimos 5 despliegues son de `fase1-seguridad` (vista previa, estado READY).
- **Riesgo confirmado (el que sospechaba ChatGPT):** ese proyecto tiene en *Preview* (todas las ramas) y en *Production* las variables `NEXT_PUBLIC_SUPABASE_URL` / `…PUBLISHABLE_KEY`, y además `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `FAL_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, OAuth de Google y Cloudflare. **Un `git push` de `beta-privada` a ese repositorio lanzaría una vista previa de la beta dentro de ese proyecto con esas variables.** (No se descifró ningún valor; se leyeron solo nombres y destinos.)
- Defensas existentes, no suficientes por sí solas: la app de la beta se niega a arrancar con claves privilegiadas o la referencia de Production (`betaConfigProblems`), y `vercel.json` de la rama limita construcciones a `beta-privada`.
- Protección actual del proyecto: SSO de Vercel activo (todos los despliegues salvo dominios propios); sin contraseña ni IP de confianza.

**Decisión de diseño:** la beta va en un **proyecto Vercel nuevo e independiente** (`cerebro-studio-beta`) que no hereda variables, y **no se hace push de `beta-privada` al repositorio ya vinculado**. Dos formas, a elegir por Jesús: (1) despliegue por subida directa de los archivos de la rama (CLI/API de Vercel; sin Git); (2) repositorio GitHub privado nuevo solo para la beta. Hasta decidirlo, **push prohibido**.

## 3. Seguridad (verificado)

- `supabase/beta/schema-beta.sql` incorpora: política restrictiva `*_project_must_be_own` (propiedad de proyectos; probada 18/18 con GoTrue/PostgREST reales y 12/12 en Postgres desechable) y `channel_connections` con **`revoke all` para `authenticated` y `anon`** (más estricto que la propuesta: ni siquiera `provider,status` se lee; los tokens no son accesibles por la API). Bucket `generated-assets` privado con políticas por carpeta de usuario.
- `predeploy:check` **falla cerrado**, probado hoy: sin `--env` → rechazado; fichero inexistente → rechazado; URL de Production → rechazado; clave service-role y de OpenAI → rechazado; `.env.beta.example` con marcadores vacíos → rechazado; configuración válida de ejemplo (ref de 20 caracteres, solo las 3 variables) → **APTO 7/7**.
- Aislamiento de usuarios: pruebas A/B de la suite E2E (46/46) y propuestas (18/18).
- Nada de esto se ha aplicado en remoto.

## 4. Acceso privado (nuevo, implementado y probado en local)

Una URL difícil de adivinar **no** es protección. El registro de la app estaba abierto (`/login` permite «Crear cuenta»). Se ha añadido al final de `schema-beta.sql`:
- Tabla `beta_allowed_emails` (sin acceso desde la API pública) y disparador `a_beta_signup_guard` sobre `auth.users` (alta y cambio de correo): **si el correo no está en la lista, no se crea la cuenta** (email, enlace mágico u OAuth). Con la lista vacía nadie se registra (falla cerrado).
- Prueba con GoTrue/PostgREST oficiales (`scripts/official-allowlist-check.mjs`): **8/8** (lista vacía bloquea; autorizado entra y puede iniciar sesión; no autorizado rechazado y sin fila; mayúsculas no duplican; la lista no se lee ni se modifica con la clave pública; cambiar el correo a uno no autorizado queda bloqueado).
- Capas recomendadas además: desactivar «Allow new users to sign up» en Auth del proyecto nuevo; Vercel Authentication activa (solo Jesús con 1 miembro; los testers externos no podrían pasar esa capa en un equipo de un miembro, por eso la lista de correos es el control real); empezar solo con el correo de Jesús; añadir testers con `insert into public.beta_allowed_emails values ('correo@…')` desde el editor SQL.

## 5. Secuencia de despliegue (no ejecutada; cada paso con su autorización)

1. **Decidir** la salida de Supabase (A recomendado) y la vía de Vercel (subida directa o repo privado nuevo).
2. *[Autoriza Jesús]* Crear la cuenta/proyecto Supabase gratuito nuevo, región UE (p. ej. `eu-central-1`). Recurso creado: 1 proyecto (≈ 500 MB BD, 1 GB almacenamiento en plan gratuito). Comprobar en su panel que aparece «Free».
3. *[Autoriza Jesús]* Aplicar `supabase/beta/schema-beta.sql` **solo** en ese proyecto (SQL editor). Comprobar: tablas con RLS, bucket privado, `beta_allowed_emails` vacía. Desactivar registros en Auth; insertar el correo de Jesús.
4. Preparar un fichero con las 3 variables (URL y clave publicable del proyecto nuevo + `NEXT_PUBLIC_CEREBRO_BETA=private`) y ejecutar `npm run predeploy:check -- --env <fichero>` → debe dar APTO 7/7.
5. *[Autoriza Jesús]* Crear el proyecto Vercel `cerebro-studio-beta` (sin integración con el repositorio actual), añadir solo esas 3 variables en todos los entornos, activar Vercel Authentication, sin crons ni dominio propio.
6. *[Autoriza Jesús]* Desplegar la rama `beta-privada` por subida directa (o repo privado nuevo). Nunca `fase1-seguridad`, nunca push al repositorio vinculado a `cerebro-studio`.
7. **Verificar aislamiento**: la URL abre `/login`; un correo no autorizado no puede registrarse; el autorizado sí; en el panel de Supabase de Production no aparece ningún usuario ni fila nueva; las rutas API fuera de las 4 permitidas devuelven cierre; el proyecto Vercel `cerebro-studio` no muestra despliegues nuevos.
8. Importar medios reales y exportar un MP4 desde el navegador de Jesús (memoria libre ≥ 2 GB recomendada; cerrar programas).

**Detener o eliminar:** pausar el proyecto Supabase nuevo (o eliminarlo) y eliminar `cerebro-studio-beta` en Vercel; ninguno afecta a Production ni a otros proyectos. Los usuarios y archivos de la beta son sintéticos o de prueba.

## 6. Costes potenciales

0 € con Supabase gratuito (cuenta nueva) y Vercel Hobby. Riesgos de coste: pasar a Pro en Supabase (si se eligiera C); límites de Vercel Hobby (uso personal, sin carácter comercial); ninguna clave de pago de proveedores (OpenAI, FAL, Gemini) debe existir en la beta; el proyecto gratuito de Supabase se pausa tras inactividad prolongada.

## 7. Autorizaciones que necesitamos de Jesús (todas pendientes)

Elegir A/B/C para Supabase; crear cuenta/proyecto Supabase nuevo; aplicar el esquema solo allí; crear el proyecto Vercel independiente con 3 variables; elegir subida directa o repositorio privado nuevo y desplegar; lista de correos de testers. Prohibido mientras tanto: push, despliegues, creación de proyectos, gastos, credenciales reales, migraciones remotas y cualquier cambio en Production.
