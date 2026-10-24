# Almacenamiento en la nube: auditoría y propuesta

Estado: octubre de 2026, rama `fase1-seguridad`. Sin migraciones ni servicios nuevos.

## 1. Lo que ya existe (comprobado en el código y en la base de datos)

| Pieza | Estado |
|---|---|
| Almacén de archivos | **Supabase Storage**, bucket privado `generated-assets`. Clave `<usuario>/<proyecto o library>/<carpeta>/<archivo>`. |
| Segundo almacén preparado | **Cloudflare R2**: el código ya lo soporta (`lib/storage/server.ts`, rutas `r2:`), pero **no está configurado** (0 archivos en R2). Se activa con 4 variables `R2_*` en Vercel. |
| Biblioteca central | Tabla `assets`: cada archivo se guarda **una vez**; los montajes de cualquier proyecto lo usan por su id, sin copiarlo («Ver también otros proyectos»). Biblioteca general = archivos sin proyecto. |
| Montajes, versiones, preferencias | `render_jobs.composition` (servidor), puntos de recuperación en Storage (`versions/`, se guardan 30), preferencias y favoritos en `connector_configs`. Se abren igual desde cualquier dispositivo. |
| Exportaciones | Se suben directamente a la nube (destino «Biblioteca»); descargar es opcional. |
| Subidas | Reanudables (tus, trozos de 6 MB), huella de contenido para detectar duplicados, comprobación de tipo y tamaño, enlaces privados temporales (`/api/assets/:id/signed-url`). |
| Cuota | Las subidas se rechazan al pasar de 0,95 GB (Supabase gratis) o 9 GB (R2), configurable con `STORAGE_QUOTA_GB`. |
| Copia local | Solo IndexedDB para recuperarse de un cierre inesperado y el historial de deshacer; nunca cuenta como «guardado». |

**Uso real (consulta de solo lectura):** 47 archivos, **138 MB de 1 GB**. Las exportaciones ocupan el 73 % (101 MB en 5 vídeos; un vídeo de 30 s a 1080p ≈ 30 MB). Límite por archivo en el plan gratuito: **50 MB** (≈ 50 s a 1080p con calidad alta).

## 2. Cambios hechos ahora (sin coste)

- **Espacio usado** visible en la Biblioteca: total, cuota, almacén, límite por archivo y desglose por tipo (`/api/storage/usage`, solo lectura).
- **Borrado seguro ampliado:** antes solo se comprobaban publicaciones y derivados; ahora tampoco se puede borrar un material que use **algún montaje de cualquier proyecto** (antes se habría quedado en negro o en silencio).

## 3. Comparativa

| | Supabase gratis (actual) | Supabase Pro | Cloudflare R2 | Google Drive |
|---|---|---|---|---|
| Espacio incluido | 1 GB | 100 GB | 10 GB-mes gratis | 15 GB compartidos con Gmail |
| Coste extra | — (no se puede ampliar) | 25 $/mes + 0,0213 $/GB | 0,015 $/GB-mes | planes Google One |
| Tamaño máx. por archivo | 50 MB | 500 GB | ~5 TB | 5 TB |
| Transferencia | 5 GB/mes | 250 GB, luego 0,09 $/GB | **gratis** | gratis (cuotas de API) |
| Integración | completa | completa | **ya programada** | solo importar/exportar: no da enlaces aptos para el visor y la exportación (CORS) |
| Requisito | ninguno | facturación | cuenta Cloudflare **con método de pago** (aunque no se cobre dentro de lo gratis) | OAuth ya usado para importar |

## 4. Recomendación

1. **Ahora:** seguir en Supabase gratis, que ya cubre la Biblioteca central, las versiones y las exportaciones; vigilar el medidor. Las exportaciones de prueba son lo que más ocupa.
2. **Siguiente paso (requiere tu autorización):** activar **Cloudflare R2** para archivos nuevos (10 GB gratis, sin coste de descarga, sin límite de 50 MB). Los archivos actuales siguen funcionando en Supabase. Hay que crear la cuenta/bucket (Cloudflare pide un método de pago) y poner `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` en Vercel (Preview). No hace falta ninguna migración.
3. **Google Drive:** como origen para importar y como copia de seguridad, no como almacén de trabajo.

## 5. Exportaciones largas en servidor

La exportación rápida del navegador va fotograma a fotograma (30 s a 1080p en ≈ 21 s en este equipo). Una sesión de 90 minutos tardaría del orden de una hora y necesita la pestaña abierta, y a 1080p pasaría de 50 MB (hace falta R2). Las funciones de Vercel no sirven para render largos (límite de tiempo por ejecución). La opción realista es un trabajador con ffmpeg (servidor pequeño o cola en segundo plano) que lea el montaje y los archivos de la nube y suba el resultado; tiene coste mensual y **no se ha activado**: se presentará con precios verificados antes de contratar nada.

## 6. Límites honestos

- Editar y exportar usa memoria y caché del dispositivo mientras se trabaja; lo que no se guarda en local de forma permanente son los materiales, proyectos y exportaciones.
- En el plan gratuito de Supabase no se puede subir un archivo de más de 50 MB.

## 7. Auditoría de la integración con Cloudflare R2 (octubre de 2026)

Lo comprobado en el código, sin cuenta de Cloudflare:

- **Credenciales solo en el servidor.**
  - `R2_*` se leen únicamente en `lib/storage/server.ts` y en las rutas `/api`.
  - El navegador solo recibe enlaces firmados que caducan: 5 min para leer y 15 min para subir.
  - Ninguna variable `R2_*` lleva el prefijo `NEXT_PUBLIC_`.
- **Permisos.** Toda lectura, escritura o borrado comprueba que la ruta empieza por el id del usuario y que no contiene `..` ni caracteres de control (`assertOwnPath`). Así, una fila de `assets` que apunte al archivo de otro usuario no sirve de nada.
- **Subidas grandes.**
  - El archivo va directo del navegador a R2, sin pasar por Vercel, y no hay límite de 50 MB.
  - **Nuevo:** el enlace de subida queda firmado también con el **tamaño declarado** además del tipo. Antes se podía declarar un archivo pequeño para pasar la cuota y subir uno mayor.
  - Por encima de 5 GB hace falta una subida por partes. No está hecha, porque no hace falta para los tamaños actuales.
- **Descargas privadas y visor.**
  - Los enlaces firmados GET admiten lectura por rangos, que es lo que usa la exportación rápida.
  - El bucket necesita una regla CORS:
    - origen: la URL de la app;
    - métodos: GET, PUT y HEAD;
    - cabeceras: `content-type` y `range`;
    - cabeceras expuestas: `content-length`, `content-range` y `accept-ranges`.
- **Compatibilidad con la Biblioteca.**
  - Los archivos de R2 se guardan con el prefijo `r2:` y los de Supabase siguen igual. Ambos funcionan a la vez y no hay que migrar nada.
  - Los puntos de recuperación y las subidas desde iPhone siguen en Supabase, porque son pequeños.
- **Recuperación.**
  - Si R2 falla, la subida da un error claro y el vídeo exportado sigue disponible para descargar en el panel.
  - Si una subida a R2 se corta, hay que repetirla entera: no es reanudable, a diferencia de Supabase.
- **Costes.**
  - El plan gratuito de R2 incluye 10 GB-mes, 1 millón de operaciones de escritura y 10 millones de lectura al mes, y la salida de datos es gratis.
  - La cuota de la app se queda en 9 GB (`STORAGE_QUOTA_GB`) para no salir de lo gratuito.
  - Las operaciones que hace el editor (una lectura por rango por fragmento) quedan muy por debajo de esos límites con el uso actual.

**Para activarlo hace falta tu autorización**, porque Cloudflare pide registrar un método de pago para activar R2, aunque el uso esté dentro de lo gratuito. Los pasos son:

1. Crear el bucket.
2. Crear una clave con permiso solo sobre ese bucket.
3. Poner la regla CORS.
4. Añadir las 4 variables en Vercel, solo en Preview.

No se ha hecho nada de esto.
