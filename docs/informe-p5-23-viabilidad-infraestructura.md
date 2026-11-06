# Informe P5.23 — Viabilidad de la infraestructura de la beta

Sin acciones externas: no se crearon cuentas ni proyectos, no hubo despliegues, push, gasto, migraciones ni cambios en Production. Fecha: 6-nov-2026.

## Conclusión: **NECESITA DECISIÓN** (Supabase). Vercel: VIABLE con una condición.

## 1. Supabase: ¿vale una segunda cuenta gratuita?

- Condiciones leídas (supabase.com/terms): **no mencionan expresamente** varias cuentas por persona. Sí contienen: 1(n) «Usage Limitations» (límites por plan), **2(c) prohíbe usar el servicio más allá del alcance de acceso concedido**, 5(c) permite aplicar límites o restringir ante uso no autorizado, y 2(e)/12(b) permiten suspender o terminar por incumplir 2(c).
- La documentación de facturación dice que los 2 proyectos gratuitos se cuentan **entre todas las organizaciones donde eres propietario o administrador** y que los pausados no cuentan. Es un límite por titular, no por cuenta.
- Lectura honesta: abrir otra cuenta con otro correo solo para obtener un tercer proyecto gratuito **es el tipo de maniobra que ese límite está diseñado para impedir**; los términos no lo prohíben con esas palabras, pero 2(c) y 5(c) dejan margen a Supabase para suspender la cuenta nueva o la actual. **No lo recomiendo como camino por defecto** y retiro la opción A del informe anterior salvo que Supabase lo confirme por escrito.
- Qué sí es legítimo: **preguntar a Supabase Support** si un proyecto separado para esta beta es admisible en una cuenta nueva (acción externa que requiere autorización de Jesús; no se ha hecho). Hasta tener la respuesta, no crear nada.

Alternativas gratuitas y aisladas evaluadas (todas con inconvenientes serios):
1. **Pausar Cazador de Cupones** o **plan Pro**: descartados por ChatGPT/Jesús (otro negocio; gasto).
2. **Usar otro esquema dentro de un proyecto existente**: descartado; compartiría `auth.users` (el disparador de lista cerrada rompería los registros de Cazador) y no aísla Production.
3. **Otro proveedor gratuito de base de datos**: la app depende de Supabase Auth, Storage y PostgREST; cambiarlo es una fase de desarrollo grande, no de despliegue.
4. **Autoalojar** (VM gratuita con tarjeta, o el PC de Jesús con 3,6 GB de RAM): no viable (informes P5.17/P5.18).
5. **Esperar** a que Jesús libere un cupo por decisión propia (p. ej. si «gamemur» o «Cazador» dejan de usarse; los pausados no cuentan, así que gamemur no libera nada por sí mismo).

Resultado: **no hay hoy una ruta de 0 € que sea a la vez legítima, aislada y sin sacrificar otro proyecto**, salvo confirmación de Supabase. Es una decisión de Jesús.

## 2. Vercel: despliegue directo sin repositorio ni variables heredadas

- Según la documentación oficial de Vercel (consultada hoy): `vercel deploy` desde un directorio local **crea un proyecto nuevo** si se responde «n» a «Link to existing project», sin Git; el CLI **no sube** `.git`, `.env.local`, `.env.*.local`, `node_modules`, `.next`, `.vercel` y respeta `.vercelignore`. Un proyecto nuevo **no hereda variables** del proyecto `cerebro-studio`: solo existen las que se añadan (`vercel env add` o la herramienta de variables).
- Alternativas: `vercel build` + `vercel deploy --prebuilt` (compila en local; no se necesita en el servidor el código fuente) y la API de despliegues. La herramienta de despliegue en línea del conector está limitada a 300 archivos y 4 MiB y el proyecto tiene 893 archivos / 9,4 MB: **no sirve**; hace falta el CLI.
- Necesita una **credencial de Vercel** para el CLI (inicio de sesión de Jesús en su PC, que ya tiene Node, o un token): lo hace Jesús o autoriza expresamente.
- Plan Hobby: restringido por Vercel a uso personal/no comercial según sus condiciones de uso justo. **No he podido verificarlo en esta sesión** (la página fue bloqueada por permisos y la búsqueda no devolvió el texto). Una beta privada personal encaja; si pasa a uso comercial habría que revisarlo.

## 3. Paquete de despliegue (verificado)

- Revisados el árbol de trabajo y los archivos versionados: **no hay `.env` reales, claves, `.pem`, volcados ni copias de bases de datos**; solo `.env.example` y `.env.beta.example` (sin valores). `.gitignore` ya excluye `.env`, `.env.local`, `.env.*.local` y `.vercel`.
- Nuevo `.vercelignore`: excluye `.env*` (salvo el ejemplo), `.git`, `.github`, `docs`, `scripts`, `supabase` (incluido el esquema SQL), `tests`, `tools`, `windows`, volcados y claves. Paquete resultante **471 archivos / 5,5 MB** (antes 893 / 9,4 MB).
- **Compilación real desde la copia filtrada: correcta** (`next build --webpack`; con Turbopack el árbol completo ya compila; la copia filtrada usó webpack por una limitación de enlaces simbólicos de `node_modules`). Búsqueda en la salida compilada: ninguna clave tipo `AIza…`, `sk-…` ni JWT; la referencia de Production aparece solo como constante de la lista de rechazo de `betaConfigProblems` (no es un secreto; es la misma que figura en cualquier URL pública de ese proyecto).

## 4. Restricciones de acceso (revisión)

- **Lista cerrada de correos** en base de datos (8/8 con GoTrue real) — implementada en P5.22.
- **Registro público**: la lista bloquea la creación de cuentas, pero **no sustituye** desactivar «Allow new users to sign up» en Auth: ambas capas deben estar. Nota práctica: con el registro desactivado, el usuario de Jesús se crea desde el panel (Authentication > Users) **después** de insertar su correo en `beta_allowed_emails`; el disparador también se aplica a altas hechas por el panel.
- **Configuración efectiva de Auth del proyecto nuevo**: no puede comprobarse sin crearlo. Lista a revisar tras crearlo: registro desactivado, confirmación de correo y límites de envío del SMTP integrado, URL del sitio y URLs de redirección solo de la beta, sin proveedores OAuth.
- **Rutas**: la beta abre solo 4 rutas de API (`BETA_API_ALLOWED`) y el resto responde cerrado (barrido de 64 rutas sin sesión en E2E M33; `predeploy:check` lo vigila); sin crons.
- **Buckets**: `generated-assets` privado, políticas por carpeta del usuario (select/insert/update/delete) en `schema-beta.sql`; pruebas A/B de almacenamiento en E2E M28.

## 5. Secuencia con verificaciones (no ejecutada)

0. **Decisión de Jesús** sobre Supabase (§1). Sin ella no se continúa.
1. *Antes:* `predeploy:check` con el fichero de las 3 variables → APTO 7/7; `.vercelignore` presente; `git status` limpio; confirmar en el panel de Supabase el cupo y plan «Free».
2. Crear proyecto Supabase (según la decisión) → aplicar `schema-beta.sql` → comprobar tablas con RLS, bucket privado, `beta_allowed_emails` vacía → insertar el correo de Jesús → desactivar registro → crear su usuario.
3. Crear proyecto Vercel nuevo con el CLI (sin enlazar con el repositorio ni con `cerebro-studio`), añadir solo las 3 variables, activar Vercel Authentication, desplegar el paquete filtrado.
4. *Después:* `/login` responde; un correo no autorizado no se registra; el autorizado entra; las rutas fuera de las 4 devuelven cierre; en Production no hay usuarios ni filas nuevas; `cerebro-studio` en Vercel no muestra despliegues nuevos; importar un vídeo y exportar un MP4.
5. **Reversión:** eliminar el despliegue y el proyecto Vercel nuevos; pausar o eliminar el proyecto Supabase nuevo. No afecta a Production ni a otros proyectos.
6. **Límites gratuitos** a vigilar: Supabase gratuito (≈500 MB de base de datos, 1 GB de almacenamiento, pausa por inactividad, correos limitados); Vercel Hobby (uso no comercial, límites de ancho de banda y ejecución).

## 6. Decisiones que necesita Jesús

1. **Supabase**: autorizar una consulta escrita a Supabase Support sobre un proyecto separado para la beta; o liberar un cupo por decisión propia; o aplazar el alojamiento. No se creará ninguna cuenta ni proyecto sin su orden.
2. **Vercel**: autorizar el despliegue directo con el CLI desde su PC (su inicio de sesión) o con un token, y el nombre del proyecto `cerebro-studio-beta`.
3. Lista de correos de testers (al inicio solo el suyo).
