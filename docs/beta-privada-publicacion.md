# Beta privada · preparación de publicación (solo local, nada ejecutado)

Rama local `beta-privada` (desde el candidato P5.0, sin remoto ni seguimiento). No se ha hecho push, despliegue, proyecto externo, migración remota ni cambio en Production/Vercel.

## 1. Qué contiene la rama
- `vercel.json` **sin cron**, con `ignoreCommand` que solo compila la rama `beta-privada` (`exit 1` = compilar, `exit 0` = omitir). Sustituye a `vercel.beta.json` (eliminado): la integración Git de Vercel solo lee `vercel.json`.
- `scripts/predeploy-check.mjs` rechaza: Supabase de Production, claves de pago/privilegiadas, cron, falta de `ignoreCommand`, tiempo real activo, rutas fuera del alcance, secretos versionados. Probado: configuración buena = APTO 7/7; Production+FAL+service role = RECHAZADO; cron o sin `ignoreCommand` = RECHAZADO (9 tests).
- `supabase/beta/schema-beta.sql`: fichero único (baseline + 7 pendientes + disparador `auth.users`), generado con `bash scripts/build-beta-schema.sh`. Validado en el stack oficial local (Auth/Storage/PostgREST): **51/51**.
- `.env.beta.example`: las 3 únicas variables.

## 2. Pasos (requieren autorización de Jesús; en este orden)
1. **Supabase**: en el panel, comprobar si se puede crear otro proyecto *Free* sin tarjeta ni cambio de plan. Crear `cerebro-beta` (región cercana). No pausar Gamemur ni Cazador de Cupones.
2. **Esquema**: SQL Editor del proyecto nuevo → pegar `supabase/beta/schema-beta.sql` → Run (proyecto vacío; si falla, no repetir a medias: borrar el proyecto y recrearlo).
3. **Auth**: Email+contraseña; desactivar *Allow new users to sign up* y crear a mano los testers (lista cerrada); confirmación de correo según se quiera probar.
4. **Storage**: bucket privado `generated-assets` (las 4 políticas ya vienen en el esquema si el baseline las incluye; verificar en Storage > Policies); límite por archivo ≥ 50 MB; subida resumable activa.
5. **Vercel**: *Add New Project* → mismo repo, nombre `cerebro-studio-beta`, *Production Branch* = `beta-privada`, Next.js, Node 24.x. Variables (Production+Preview+Development): solo las 3 de `.env.beta.example`. No importar variables del proyecto actual. No tocar el proyecto existente.
6. **Push solo de `beta-privada`** (`git push -u origin beta-privada`). **Nunca** `fase1-seguridad` (el proyecto actual la despliega con variables compartidas con Production).
7. **Verificación**: `predeploy:check` con las 3 variables reales antes del push; tras el despliegue, `npm run test:e2e:editor` apuntando al Preview con datos sintéticos; comprobar RLS con dos usuarios y que `/api/*` fuera de alcance responde 404.
8. Vercel: confirmar en el panel que el *Ignored Build Step* no está sobrescrito y que el proyecto no tiene Cron Jobs.

## 3. Reversión
Vercel: borrar el proyecto `cerebro-studio-beta` (el actual no se toca). Supabase: pausar o borrar `cerebro-beta`. Git: `git push origin --delete beta-privada` (o no publicarla). Production y `fase1-seguridad` quedan intactas.

## 4. Decisiones que necesita Jesús
(a) Cupo Free de Supabase (¿hay otro proyecto sin coste?). (b) Autorizar crear el proyecto Vercel `cerebro-studio-beta`. (c) Autorizar crear el proyecto Supabase. (d) Autorizar el push de **solo** `beta-privada`. (e) Lista de testers.
