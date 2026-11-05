# Informe P5.16 — Conexiones oficiales (YouTube e Instagram) y prueba de uso

Rama `beta-privada`, 0 €. **No se creó ninguna credencial, cuenta ni conexión real; no hubo llamadas a Google, Meta ni TikTok.** Todo lo de abajo viene de la documentación oficial consultada hoy; lo que no se pudo confirmar está marcado.

## 1. Google / YouTube

### Qué necesita Cerebro Studio (leído del código)
- Variables de servidor: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 bytes en base64, cifra los tokens en base de datos). Opcional y recomendada: `CEREBRO_OAUTH_ORIGIN` (la única dirección pública registrada en Google).
- Rutas: inicio `/api/oauth/youtube/start`, retorno `/api/oauth/youtube/callback`, confirmación del canal `/api/oauth/youtube/confirm`, desconexión `/api/oauth/youtube/disconnect`. **URI de redirección a registrar:** `<dirección-de-la-app>/api/oauth/youtube/callback` (debe coincidir exactamente, incluidas mayúsculas y barra final; en pruebas locales Google admite `http://localhost:<puerto>`).
- Scopes que pide el código: lectura = `youtube.readonly` + `yt-analytics.readonly`; con permiso de subida añade `youtube.upload`. Cada publicación exige además la aprobación manual de Jesús.

### Guía paso a paso (para Jesús, más adelante; nada de esto se ha hecho)
1. En Google Cloud Console crear un proyecto y habilitar **YouTube Data API v3** y **YouTube Analytics API**.
2. Configurar la pantalla de consentimiento OAuth: tipo **Externo**; añadir tu cuenta como **usuario de prueba**.
3. Crear un cliente OAuth de tipo **Aplicación web** y añadir la URI de redirección de arriba.
4. Guardar el ID y el secreto (el secreto se muestra una sola vez) como variables del servidor, nunca en el código.
5. En Cerebro Studio: Conectores → «Conectar solo lectura». Confirmar el nombre y el ID del canal que se muestra. Solo si quieres publicar: «Permitir subida de vídeos».

### Requisitos y límites (documentación oficial)
- Modo **Testing**: máximo 100 usuarios de prueba y **las autorizaciones y sus refresh tokens caducan a los 7 días** (hay que reconectar). Pasar a producción puede exigir verificación si se piden scopes sensibles o restringidos; una app sin verificar con esos scopes tiene un tope de 100 usuarios nuevos de por vida (fuente: ayuda de Google Cloud sobre la pantalla de consentimiento).
- Redirect URIs: coincidencia exacta o error `redirect_uri_mismatch`. `state` obligatorio contra CSRF; revocación en `oauth2.googleapis.com/revoke` (implementada).
- `videos.insert`: la documentación del método indica coste de 1 unidad en el cubo «Video Uploads» y 100 llamadas al día (la cuota general de Data API sigue siendo la de P5.8). Dice que los vídeos de proyectos sin verificar no se restringen a privado.
- **No confirmado en esta consulta:** si `youtube.upload` y `yt-analytics.readonly` figuran como scopes «sensibles» a efectos de verificación (la página de scopes quedó truncada), y la lista exacta de reglas de URI. Hay que revisarlo en la consola de Google antes de pasar a producción.

## 2. Meta / Instagram

### Qué necesita Cerebro Studio
- Variables: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CEREBRO_OAUTH_ORIGIN`. Retorno: `<dirección>/api/oauth/instagram/callback`.
- Código: «Instagram API with Instagram Login». Permisos: lectura = `instagram_business_basic`; publicar Reels añade `instagram_business_content_publish`.

### Guía (para Jesús, más adelante)
1. Cuenta de Instagram **profesional**.
2. En Meta for Developers crear una app y añadir el producto «Instagram» con **Instagram API with Instagram Login**.
3. Registrar la URI de redirección OAuth y añadir tu usuario con un **rol en la app** (Standard Access basta para cuentas con rol).
4. Copiar ID y secreto de la app de Instagram a las variables del servidor.
5. En Cerebro Studio: Redes sociales → «Solo lectura (sin publicar)» o «Conectar Instagram (Reels)».

### Requisitos y límites (documentación oficial)
- Instagram Login: permisos `instagram_business_basic` e `instagram_business_content_publish` para publicar; Facebook Login usa otros permisos y exige página de Facebook enlazada.
- **Standard Access** es el nivel por defecto, para usuarios con rol en la app y pruebas. **Advanced Access** (App Review + verificación de empresa) hace falta para cuentas que no administras o usuarios sin rol.
- Reels: contenedor `media_type=REELS` con `video_url`; **el vídeo debe estar en un servidor públicamente accesible** cuando Meta lo descarga (relevante: Cerebro Studio tendría que servir el MP4 mediante una URL pública temporal firmada, aún no diseñado). Límite de ~100 publicaciones por API en 24 h (la página se contradice con 50 para carruseles).
- Tokens: de larga duración 60 días, renovables antes de caducar (la renovación automática no está implementada: pendiente).
- **No confirmado:** formatos/duración exactos de Reels y métricas de Instagram Login (la página no los indica); reglas para cuentas de prueba más allá de los roles.

## 3. Auditoría OAuth local
| Aspecto | Resultado |
|---|---|
| `state` y CSRF | OK: nonce aleatorio en cookie httpOnly/sameSite=lax con identificador de usuario, comparación en tiempo constante, caduca a 10 min |
| PKCE | No usado. No es obligatorio en el flujo web con secreto de Google y de Instagram; TikTok no verificado |
| Redirecciones | **Corregido:** las redirecciones usaban el origen de la petición; ahora los URI de retorno se fijan con `CEREBRO_OAUTH_ORIGIN` si existe (solo https, o localhost) y las redirecciones internas son relativas |
| Tokens | OK: cifrados con AES-256-GCM antes de guardarse; el canal pendiente va cifrado en cookie y solo se guarda al confirmar |
| Renovación / revocación | YouTube: renovación y estado `expired` ante `invalid_grant`, revocación en Google al desconectar. Instagram: sin renovación automática (pendiente) |
| Aislamiento | OK: consultas filtradas por `owner_id` y RLS de `channel_connections` (el GRANT pendiente sigue documentado en P5.11) |
| Mínimo privilegio | **Corregido:** Instagram/TikTok pedían siempre el permiso de publicar; ahora hay «Solo lectura (sin publicar)» (`?scope=read`) y YouTube ya distinguía lectura/subida |
| Errores | OK: mensajes sin datos privados; `not_configured` explicado en pantalla |
Pruebas: `tests/oauth-security.test.ts` (4), E2E 43/43, Vitest 1671, tsc y ESLint sin errores. Chromium principal: último resultado completo 686/686 (P5.15); este cambio solo toca la página Redes sociales y rutas OAuth.

## 4. Prueba de uso directa para Jesús (≈15 min)
**Acceso seguro:** la app solo corre en el entorno local de pruebas; no se expone a Internet. La vía segura es ejecutarla en **tu PC** (`npm install`, `npm run build`, `npm start` con el stack local de Supabase) y abrir `http://localhost:3000`; no abras puertos ni uses túneles públicos. Hasta que lo ejecutes tú, no se ha realizado ninguna prueba por tu parte.
1. Inicia sesión con una cuenta de prueba. 2. Crea un proyecto. 3. Importa un vídeo y una imagen (botón «Importar y añadir» en el editor manual). 4. Recorta el clip al añadirlo. 5. Añade música desde Materiales > Música y sonidos. 6. En Textos importa un .srt o pega una transcripción y revisa los subtítulos en el visor. 7. Exporta (480p, destino Biblioteca). 8. Abre la Biblioteca y reproduce el MP4; cierra sesión y vuelve a entrar para comprobar que sigue ahí.
Anota: pasos donde dudaste, mensajes poco claros y qué echaste en falta.

## 5. Bloqueos que necesitan autorización de Jesús
- Crear los proyectos/credenciales de Google y Meta y aprobar las conexiones en pantalla.
- Una dirección estable y protegida (alojamiento aislado) para las URI de redirección antes de usar credenciales reales; no conviene meter credenciales reales en la beta local.
- Aplicar la política RLS de propiedad de proyecto y el GRANT pendiente (sigue sin aplicarse en remoto).
- Decidir prioridad: YouTube primero (investigación y, después, publicación), Instagram después.
