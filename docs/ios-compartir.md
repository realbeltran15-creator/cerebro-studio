# Enviar archivos desde el iPhone a Cerebro Studio

Estado: octubre de 2026. Rama `fase1-seguridad` (Preview privada).

## 1. Qué permite iOS de verdad

| Vía | ¿Funciona en iPhone? | Notas |
|---|---|---|
| **Web Share Target** (la web aparece en el menú Compartir) | **No** | WebKit no lo implementa: el bug 194593 sigue abierto. Safari ignora `share_target` del manifiesto, aunque la web esté añadida a la pantalla de inicio. |
| **PWA / icono en pantalla de inicio** | Sí | Abre Cerebro Studio a pantalla completa en «Añadir materiales». No añade nada al menú Compartir. |
| **`<input type="file">` en Safari** | Sí | Abre el selector de iOS: Fototeca, Hacer foto o vídeo, Elegir archivo (app Archivos e iCloud Drive). Admite selección múltiple. |
| **Atajo (app Atajos)** | Sí | Un atajo puede aparecer en el menú Compartir y enviar el archivo con «Obtener contenido de URL», que admite PUT/POST, cabeceras y cuerpo de archivo. No necesita Mac ni cuenta de desarrollador. |
| **Extensión nativa de Compartir** | Solo con app nativa | Requiere Mac con Xcode y una app iOS. Ver la sección 5. |

Fuentes:

- https://bugs.webkit.org/show_bug.cgi?id=194593
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
- https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- https://support.apple.com/en-al/guide/shortcuts/apd58d46713f/ios
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl

## 2. Qué está hecho

**Página `/add` («Añadir materiales»)**

- Panel único con tres fuentes: el dispositivo (Fotos, Archivos o cámara), Google Drive (el selector oficial con el permiso `drive.file`) y el Atajo de iPhone.
- Destino a elegir: la Biblioteca general (sin proyecto) o un proyecto concreto.
- Subida **reanudable** con el protocolo TUS de Supabase:
  - Bloques de 6 MB, con barra de progreso.
  - Si se corta la red, reintenta con espera creciente y continúa desde el último byte confirmado.
  - Si se vuelve a elegir el mismo archivo tras cerrar la pestaña, también continúa.
  - El navegador solo guarda la URL de la subida, nunca el vídeo.
- Cancelar, quitar, reintentar y «Subir igualmente».
- **Duplicados:** se detectan por la huella SHA-256 del tamaño y del principio y final del archivo, antes de subir nada.
- **Originales sin modificar:** no se comprime ni se convierte nada.
- Formatos aceptados: MOV, MP4, WebM, JPEG, PNG, WebP, M4A (Notas de Voz), MP3, WAV, AAC, OGG y FLAC.
  - HEIC se rechaza con una explicación: el editor no lo decodifica fuera de Safari. iOS suele convertirlo a JPEG al elegirlo en Safari.
- Todo queda privado: la carpeta del usuario está protegida con RLS y la sesión es obligatoria.
- Los materiales de la Biblioteca general también aparecen en el Editor manual de cualquier proyecto, con la etiqueta «Biblioteca general».
- Icono y manifiesto para añadirla a la pantalla de inicio. Abre directamente en `/add`.

**Atajo de iPhone (menú Compartir)**

- `/api/ios/token` crea, cambia de destino o revoca un código personal.
  - El código empieza por `cs_`, se muestra una sola vez y en la base de datos solo se guarda su hash SHA-256.
  - Se guarda en `connector_configs`, de modo que no hace falta ninguna migración.
- `/api/ios/start` recibe el código, el nombre y el tamaño, y devuelve una URL de subida firmada de un solo uso (válida 2 h) dentro de la carpeta del dueño.
- `/api/ios/finish` comprueba lo que llegó de verdad (tamaño y tipo) y gestiona los duplicados:
  - Si es un duplicado, borra la copia nueva.
  - Si no, registra el material y responde con un texto que el Atajo muestra.

## 3. Requisitos pendientes para que el Atajo funcione en la Preview

Estas dos decisiones son del propietario. No se han tocado.

1. **Vercel Authentication** protege la Preview. El Atajo no tiene la cookie de sesión de Vercel, así que necesita la cabecera `x-vercel-protection-bypass`.
   - Se crea en Vercel › Proyecto › Settings › Deployment Protection › *Protection Bypass for Automation*.
   - La Preview sigue siendo privada para el resto: solo quien tenga ese secreto pasa.
   - El secreto se guarda dentro del Atajo, en el iPhone.
2. **`SUPABASE_SERVICE_ROLE_KEY`** en las variables del entorno Preview de Vercel.
   - Sin ella, `/api/ios/*` responde 503 con una explicación.

Mientras no estén, la vía funcional es Safari: sección 6.

## 4. Límites reales del almacenamiento (Supabase Free)

- **50 MB por archivo.** No se puede subir en el plan gratuito. Con el plan Pro (de pago) se ajusta hasta 500 GB.
  - La variable `SUPABASE_MAX_FILE_MB` solo debe subirse si se cambia de plan.
- **1 GB de almacenamiento total** en el plan Free. Ahora hay unos 41 MB ocupados.
  - La app avisa al acercarse a 0,95 GB (ajustable con `STORAGE_QUOTA_GB`).
- Un minuto de vídeo 4K HEVC del iPhone ocupa unos 170-400 MB. Con 50 MB caben unos 10-20 s en 4K, o 1-2 min en 1080p a 30 fps.
  - Para vídeos largos hay tres opciones: recortarlos en Fotos (Editar), grabar en 1080p, o activar un almacenamiento mayor.
  - El código ya admite Cloudflare R2: el navegador sube directamente con una URL firmada.
  - **No se ha activado nada de pago.**
- Al elegir vídeos desde la Fototeca, iOS a veces entrega una copia compatible (H.264) en lugar del HEVC original. Elegirlos desde Archivos entrega el archivo tal cual.

## 5. Propuesta: extensión nativa de Compartir

Qué hace falta:

- Mac con Xcode.
- Una app SwiftUI mínima con un *Share Extension* que acepte `public.movie`, `public.image` y `public.audio`.
- La extensión reutiliza **los mismos endpoints** (`/api/ios/start` y `/api/ios/finish`) y el mismo código personal. En el servidor no cambia nada.
- Archivos grandes: la extensión entrega el archivo a una `URLSession` en segundo plano, porque las extensiones tienen poca memoria y poco tiempo de vida.

Distribución:

- **Sin pagar:** cuenta Apple gratuita («Personal Team»). La app se instala desde Xcode en tu propio iPhone y caduca a los 7 días, así que hay que reinstalarla.
- **Apple Developer Program (99 USD al año):** TestFlight o instalación permanente. Publicarla en la App Store además requiere revisión de Apple.

Qué se puede hacer ya y qué no:

- **Ahora, sin coste:** la página `/add` en Safari, el icono en la pantalla de inicio y el Atajo (cuando estén los requisitos de la sección 3).
- **Necesita Mac + Xcode:** la extensión nativa.
- **Necesita cuota de Apple o publicación:** la instalación permanente o en la App Store. No se ha enviado nada a revisión.

## 6. Pasos en el iPhone (vía que funciona hoy)

1. Abre Safari y entra en la URL de la Preview. Inicia sesión en Vercel y en Cerebro Studio.
2. Ve a **Biblioteca › Añadir materiales**, o abre directamente `/add`.
3. Opcional: toca Compartir (el cuadrado con flecha) y luego **Añadir a pantalla de inicio**. Así tendrás el icono «Cerebro», que se abre en esta página.
4. En «¿Dónde los guardo?» elige la Biblioteca general o un proyecto.
5. Toca **Fotos, Archivos o este equipo**, luego **Fototeca** (o **Elegir archivo**), marca los vídeos y toca **Añadir**.
6. Mantén Safari abierto hasta que cada fila diga «Subido». Si se corta, vuelve a elegir el mismo archivo y continuará donde iba.
7. En el ordenador, el material aparece en Biblioteca y en el Editor, con el botón «Abrir en el Editor».

### Atajo (cuando se cumplan los requisitos de la sección 3)

En `/add › Compartir desde el iPhone`, genera el código y sigue los pasos que muestra la página.

El Atajo hace lo siguiente:

1. Recibe un archivo desde la hoja de Compartir.
2. Hace un POST a `/api/ios/start` con `Authorization: Bearer <código>`.
3. Hace un PUT del archivo a `putUrl`, con la cabecera `Content-Type` que devuelve el servidor.
4. Hace un POST a `/api/ios/finish`.
5. Muestra la respuesta.

En la Preview, las tres peticiones llevan además `x-vercel-protection-bypass`.
