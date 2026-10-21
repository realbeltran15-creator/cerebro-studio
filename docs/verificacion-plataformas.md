# Verificación de plataformas: Google (YouTube), Meta (Instagram) y TikTok · 21-10-2026

Preparado por Claude. **No se ha enviado ninguna solicitud de verificación ni se ha cambiado el estado público de ninguna app.**

**URLs públicas (rama `fase1-seguridad`, sin iniciar sesión):**

| Página | URL |
|---|---|
| Página principal | https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/ |
| Privacidad | https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/legal/privacidad |
| Términos | https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/legal/terminos |
| Eliminación de datos | https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/legal/eliminar-datos |

El correo de contacto se muestra si existe `NEXT_PUBLIC_CONTACT_EMAIL`; está pendiente de que el propietario decida cuál usar.

> **Bloqueo comprobado el 21-10-2026: la Preview está protegida por «Vercel Authentication».**
> - Un visitante sin sesión en Vercel recibe un 302 hacia el inicio de sesión de Vercel, en todas las páginas, también en `/legal/*` y `/api/meta/*`.
> - Por tanto, los revisores de Google, Meta y TikTok **no pueden ver** estas páginas en la Preview, y Meta **no puede llamar** a los callbacks.
> - Producción (`https://cerebro-studio.vercel.app`) sí es pública (200), pero sigue en `main` sin estas páginas.
> - Hay dos salidas, ambas decisión del propietario:
>   - publicar estas páginas en Producción (merge o despliegue de `main`);
>   - quitar la protección de las Preview en Vercel → Settings → Deployment Protection, cosa que expone todas las ramas de Preview.

---

## 1. Google OAuth (YouTube)

### Estado real (consola, 21-10-2026)

| | |
|---|---|
| Proyecto | `cerebro-studio-509818`, con un único cliente web «Cerebro Studio» |
| Estado de publicación | **Prueba (Testing)** |
| Usuarios de prueba | 2: realbeltran15@gmail.com y youturbopro@gmail.com |
| URI de retorno | 4, incluida la de la Preview `fase1-seguridad` (añadida el 21-10) |
| Dominios autorizados | Los 4 subdominios `*.vercel.app` del proyecto |
| Permisos declarados | Corregidos el 21-10. Solo los 3 que usa el código (abajo) |
| Página principal, privacidad y términos en la pantalla de consentimiento | **Vacíos**. Las páginas ya existen; falta poner sus enlaces |

**Clasificación de los permisos según la propia consola:**

| Permiso | Clasificación |
|---|---|
| `yt-analytics.readonly` | No sensible |
| `youtube.readonly` | **Sensible** |
| `youtube.upload` | **Sensible** |

Ninguno es restringido, así que **no hace falta la evaluación de seguridad CASA**.

### Caducidad de 7 días

- Según la documentación oficial, el token de actualización caduca a los 7 días cuando el estado es «Testing» y se piden permisos que no son solo nombre, correo y perfil. Fuente: https://developers.google.com/identity/protocols/oauth2#expiration
- Esa regla va ligada al estado «Testing». **Pasar a «In production» la elimina**, aunque la app no esté verificada.
- Siguen aplicándose las demás causas de caducidad:
  - revocación por el usuario;
  - 6 meses sin uso;
  - máximo de 100 tokens por cuenta y cliente.
- **Restricciones de una app en producción sin verificar con permisos sensibles:**
  - Google muestra la pantalla «Google no ha verificado esta app» antes del consentimiento.
  - Hay un límite de 100 usuarios nuevos en total.
  - La app puede aparecer como no verificada en la Revisión de seguridad.
  - Fuente: https://support.google.com/cloud/answer/7454865
- Uso personal: según la documentación de verificación de permisos sensibles, si el único usuario eres tú o unas pocas personas que conoces, la verificación **no es obligatoria**; se puede continuar pasando la pantalla de app no verificada (sigue el límite de usuarios). Fuente: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification

**Recomendación:** pasar a «In production» sin pedir verificación mientras solo la uses tú. Así se elimina la caducidad semanal. Pedir la verificación solo si vas a abrir la app a otras personas.

**Cambio preparado, NO ejecutado:** en Google Auth Platform → Público, pulsar «Publicar app». Necesita la autorización del propietario.

### Para pedir la verificación más adelante

1. **Dominio propio:** Google exige que la página principal y la de privacidad estén en un dominio verificado en Search Console. Los subdominios `vercel.app` se pueden verificar como propiedad de prefijo de URL con una metaetiqueta, pero lo recomendable es un dominio propio, que puede costar dinero. Debe ser el dominio de Producción: decisión del propietario.
2. **Pantalla de consentimiento:**
   - Página principal: `/`
   - Privacidad: `/legal/privacidad`
   - Términos: `/legal/terminos`
   - Logotipo de 120×120 px (opcional; si se sube, obliga a verificar).
3. **Justificación de los permisos (texto para el formulario):**
   - `youtube.upload`: «Cerebro Studio sube a YouTube únicamente los vídeos que el propietario del canal ha preparado, revisado y aprobado de forma explícita en la app, y solo al pulsar «Publicar». Por defecto se suben como privados. No existe un permiso más limitado que permita subir vídeos.»
   - `youtube.readonly`: «Se usa para identificar el canal autorizado (nombre e ID, channels.list?mine=true) y mostrarlo antes de confirmar la conexión y antes de cada subida, y para comprobar tras la subida que el vídeo existe en ese canal con la visibilidad aprobada (videos.list). No modificamos ni borramos nada.»
   - `yt-analytics.readonly`: «Se muestran al propietario los informes de analítica de su propio canal dentro de la app.»
4. **Vídeo de demostración (subirlo a YouTube como «No listado»):**
   1. Abrir Conectores y pulsar «Conectar canal (con permiso de subida)».
   2. Mostrar la URL de Google con el `client_id` y el selector de cuentas.
   3. Mostrar la pantalla de consentimiento con el nombre «Cerebro Studio» y los 3 permisos.
   4. Volver a la app y mostrar el recuadro «¿Es este el canal correcto?» con el nombre y el ID; confirmarlo.
   5. En YouTube: preparar un borrador privado y aprobarlo escribiendo APROBAR.
   6. Pulsar «Publicar en YouTube» y mostrar el diálogo con el canal y su ID.
   7. Pulsar «Comprobar en YouTube» y mostrar el canal y la visibilidad privada.
   8. Abrir Analytics.
   9. Pulsar «Desconectar» y mostrar la página de eliminación de datos.

### Prevención de errores (comprobado en el código)

| Requisito | Estado |
|---|---|
| Detecta autorizaciones caducadas | Sí: si Google responde `invalid_grant`, la conexión pasa a «expired» y se muestra un aviso con la causa y cómo reconectar |
| Renueva el token cuando Google lo permite | Sí: se refresca automáticamente si faltan menos de 60 s para que caduque |
| Pide reconectar solo cuando hace falta | Sí: solo si el refresco falla |
| Permite elegir la cuenta | Sí: `prompt=select_account consent` |
| Verifica el ID del canal antes de publicar | Sí: el servidor rechaza la subida si el ID confirmado no coincide |
| Tokens inaccesibles al navegador | Sí: cifrados, y las columnas de tokens no se pueden leer desde el navegador (migración de seguridad aplicada) |
| No duplica conexiones | Sí: un único registro por canal; al confirmar otro canal, el anterior deja de poder usarse |
| No publica al reconectar | Sí: ninguna ruta de conexión publica |

---

## 2. Instagram (Meta)

### Implementado

- **Login:** «Instagram API with Instagram Login».
  - Permisos `instagram_business_basic` e `instagram_business_content_publish`.
  - `force_reauth=true` para poder cambiar de cuenta.
  - Token de larga duración (60 días) que se renueva solo cuando faltan menos de 7 días.
- **Publicación de Reels:**
  - Contenedor `media_type=REELS` con una URL firmada y temporal del vídeo.
  - Espera hasta `FINISHED` y después `media_publish`, guardando el enlace permanente.
  - Si el contenedor sigue procesándose, el siguiente clic lo reanuda sin duplicar.
- **Comprobación previa del formato:** exige MP4 con H.264/HEVC y audio AAC (el Editor convierte gratis sin GPL).
- **Antes de publicar:** aprobación sellada, cuenta y su ID en pantalla, y el servidor rechaza cualquier otra cuenta.
- **Una sola cuenta utilizable:** al conectar otra, la anterior deja de usarse.
- **Desconexión:** borra las credenciales.
- **Callbacks de Meta** «Desautorizar» y «Eliminación de datos»: `/api/meta/deauthorize` y `/api/meta/data-deletion`. Verifican `signed_request` con HMAC-SHA256 y el secreto de la app, borran las credenciales de esa cuenta y devuelven `url` y `confirmation_code`.

### Lo que falta (externo)

1. **Crear la app en Meta for Developers** (tipo «Empresa») y añadir el producto «Instagram» → «API setup with Instagram login».
2. **Variables en Vercel (Preview):** `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`, del Instagram App ID/secret del producto, no los de Facebook.
3. **Configuración de la app:**

   | Campo | Valor |
   |---|---|
   | URI de retorno OAuth | `https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/api/oauth/instagram/callback` |
   | Deauthorize callback | `…/api/meta/deauthorize` |
   | Data deletion request URL | `…/api/meta/data-deletion` |
   | Privacy Policy URL | `…/legal/privacidad` |
   | Terms URL | `…/legal/terminos` |

4. **Cuenta de Instagram:** debe ser **profesional** (Empresa o Creador).
5. **Modo desarrollo:** solo funcionan las cuentas añadidas como **Instagram testers** de la app, que deben aceptar la invitación en Instagram. Así se puede probar sin revisión.
6. **App Review** (para cuentas de otras personas, y para poner la app en modo Live):
   - Solicitar Advanced Access a `instagram_business_basic` e `instagram_business_content_publish`.
   - Incluir un screencast: conectar, elegir cuenta, preparar un borrador de Reel, aprobar, publicar y ver el enlace permanente.
   - Meta suele pedir además verificación de la empresa.
7. **Límite de publicación:** la documentación da 100 publicaciones por API cada 24 h en un apartado y 50 en otro. Consultar `content_publishing_limit` antes de depender de uno de los dos.

---

## 3. TikTok

### Implementado

- **Login Kit (Web):** permisos `user.info.basic` y `video.publish` (los mínimos para Direct Post).
- **Tokens:** acceso de 24 h, que se renueva solo con el refresh token de 365 días.
- **Direct Post con FILE_UPLOAD:**
  - No necesita verificar dominio, que sí haría falta con PULL_FROM_URL.
  - El vídeo se sube por fragmentos según las reglas de TikTok.
  - El estado se consulta con `status/fetch`.
- **Pantalla de publicación conforme a las Content Sharing Guidelines (añadido hoy):**
  - Lee `creator_info` al abrir el formulario y muestra el apodo y la duración máxima.
  - La privacidad la elige el usuario de un desplegable, **sin opción por defecto**, solo entre las que devuelve TikTok.
  - «Permitir comentarios / dúos / stitch» están **desmarcados por defecto** y se desactivan si el creador los tiene desactivados. En el servidor, lo que diga el creador siempre manda.
  - Divulgación de contenido comercial: desactivada por defecto. Al activarla hay que elegir «Tu marca» y/o «Contenido de marca»; el contenido de marca no puede ser privado.
  - Texto de consentimiento: «Al publicar, aceptas la Confirmación de uso de música de TikTok» (y la Política de contenido de marca si corresponde).
  - El servidor rechaza vídeos más largos de lo permitido y privacidades no ofrecidas.
  - Etiqueta de contenido generado con IA (`is_aigc`).
- **Cuenta de destino:** en pantalla con su ID; el servidor rechaza cualquier otra.
- **Desconexión:** revoca en TikTok y borra las credenciales.

### Lo que falta (externo)

1. **Crear la app en TikTok for Developers:**
   - Añadir los productos **Login Kit** y **Content Posting API**.
   - Activar **Direct Post**.
   - Pedir los permisos `user.info.basic` y `video.publish`.
2. **Variables en Vercel (Preview):** `TIKTOK_CLIENT_KEY` y `TIKTOK_CLIENT_SECRET`.
3. **Configuración de la app:**

   | Campo | Valor |
   |---|---|
   | Redirect URI | `https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/api/oauth/tiktok/callback` |
   | Web/Desktop URL | La página principal |
   | Privacy Policy | `/legal/privacidad` |
   | Terms of Service | `/legal/terminos` |
   | Icono | Obligatorio |

4. **Antes de la auditoría (cliente sin auditar):**
   - Solo se puede publicar con visibilidad `SELF_ONLY`.
   - Como máximo 5 usuarios cada 24 h.
   - La cuenta debe ser **privada** en el momento de publicar.
   - Esto permite probar de verdad sin publicar en público.
5. **Auditoría** (para publicar en público):
   - Formulario con estimación de uso y un vídeo de demostración del flujo completo cumpliendo las directrices de arriba.
   - Requisito de TikTok: la app debe ser para creadores que publican contenido original y para una audiencia amplia, no para uso interno. **Una herramienta de uso personal puede no superar la auditoría**: decisión del propietario.

---

## Decisiones del propietario

1. **Google:** pasar la app a «In production» sin verificación (elimina la caducidad de 7 días; muestra el aviso de app no verificada).
2. **Google:** poner los enlaces de página principal, privacidad y términos en la pantalla de consentimiento (cambio que no afecta a los usuarios).
3. **Correo de contacto público:** valor de `NEXT_PUBLIC_CONTACT_EMAIL` para las páginas legales.
4. **Meta y TikTok:** crear las apps y añadir sus credenciales en Vercel (Preview).
5. **Hacer públicas las páginas legales y los callbacks de Meta** (hoy la Preview exige iniciar sesión en Vercel): desplegarlas en Producción o quitar la protección de las Preview. Hace falta antes de cualquier revisión y antes de configurar los callbacks en Meta.
6. **Dominio propio:** solo si se va a pedir la verificación de Google o la auditoría de TikTok.
