# Almacenamiento y exportación: auditoría con mediciones

Todas las cifras son medidas (fecha 25-10-2026) salvo donde se indica «no medido». Equipo de medición: contenedor de 2 CPU y 7,8 GB con Chromium sin interfaz (VP9; sin descodificador H.264), por lo que describen ese entorno, no una promesa para otros navegadores.

## 1. Dónde está cada cosa

| Qué | Dónde | Medido |
|---|---|---|
| Originales importados (vídeo, audio, imagen) | Supabase Storage, bucket privado `generated-assets` (o R2 si se configura; **no está activado**). Ruta `usuario/proyecto/uploads/…` | 69 objetos, 162,9 MB en total (17 % de la cuota de 0,95 GB) |
| Exportaciones guardadas en la Biblioteca | Mismo bucket, carpeta `renders` | 7 archivos = 121,2 MB (74 % de todo el bucket) |
| Imágenes/voces generadas con IA | Mismo bucket | ~22 MB; 25 filas no registraron su tamaño (la página Almacenamiento lo avisa) |
| Versiones de montaje | Mismo bucket, `versions/` | 31 objetos, 90 KB |
| Datos de montaje (proyecto, clips) | Tabla `render_jobs` (texto) | 30 montajes = 97,5 KB; el mayor 6,7 KB. Base de datos completa: 15,4 MB |
| 300 repeticiones de un clip | Solo JSON: todas apuntan al mismo archivo | 106,4 KB de JSON, 1 original; **0 bytes extra de material** |
| Borrador local y deshacer | IndexedDB del navegador | 1,6 MB en el navegador real |
| Miniaturas/proxies | No se guardan: se calculan en memoria | – |
| Material al editar y exportar | No se descarga al disco: se lee por rangos desde enlaces firmados | – |

## 2. Temporales de renderizado

- **Exportación en el navegador a «Descargar»**: el MP4 se arma entero en memoria y se entrega a la descarga (cabe en memoria: factor 2–2,7 × el tamaño, medido antes). No usa disco hasta que el navegador lo guarda en Descargas (disco interno por defecto).
- **Exportación en el navegador a «Carpeta o disco»** (nuevo): se escribe a medida que se produce, en el archivo que elijas. Medido en 1, 3 y 6 min de 1080p: pico de memoria JS 149/479/733 MB al armar en memoria frente a 202/669/286 MB escribiendo a archivo. A 6 min la escritura progresiva usa un 61 % menos de memoria JS; a 3 min no lo mejoró (el pico es ruidoso: depende del recolector de basura). La memoria total del proceso del navegador fue la misma (≈2,9 GB: dominada por la descodificación de los vídeos de origen, no por el archivo de salida). **Conclusión honesta:** la escritura progresiva elimina el crecimiento proporcional al tamaño del archivo, pero no reduce el resto del coste del navegador. En montajes de horas (archivo de varios GB) es lo que evita agotar la memoria.
- **Cancelar / disco lleno**: probado con un destino que rechaza la escritura a los 5 MB (QuotaExceededError): la exportación falla limpiamente, **0 bytes confirmados** en el archivo; cancelar a mitad deja también 0 bytes. El montaje no se toca.
- **Motor offline de Node/FFmpeg («Paquete para renderizar en mi PC»)**: carpeta de trabajo de 7,5 MB para un vídeo de 41 s y de 7,6 MB para uno de 201 s (40 repeticiones): los segmentos idénticos se renderizan una sola vez. Con contenido que no se repite la carpeta de trabajo crecerá (no medido); permanece tras terminar y puede borrarse. Descarga los materiales a `--work`: apuntándola a un disco externo (`--out E:\video.mp4 --work E:\temporal`) no usa el disco interno.
- ¿Una exportación de 90 min o 5 h necesita disco interno? En el navegador **no** si se elige «Carpeta o disco» (el único uso de disco interno es el swap de Chrome, que se crea junto al destino). Si se descarga: sí, el archivo completo termina en Descargas y antes en memoria. Con Drive: sí, un temporal del tamaño del vídeo en el almacenamiento del navegador (disco interno) hasta terminar de subir.
- Después de exportar pueden borrarse con seguridad: el temporal de Drive (la página Almacenamiento lo lista y borra), la carpeta de trabajo del motor offline y el borrador local. **Nunca** los originales ni materiales usados.

## 3. Destinos de exportación (panel Exportar)

| Destino | Estado |
|---|---|
| Descargar a mi equipo | Funciona (probado en el Preview real). |
| Carpeta o disco externo | Funciona con el selector de archivos del navegador (Chrome/Edge); se elige **antes** de renderizar. Probado en el Preview real con un selector simulado que escribe en el almacenamiento del navegador: archivo MP4 de 4,2 MB, válido (ftyp, 1280×720, 12,01 s). **No probado con el diálogo nativo de Windows ni con un disco externo físico.** Chrome crea un `.crswap` junto al destino y lo confirma al cerrar. Firefox/Safari no ofrecen el selector: se desactiva la opción y se explica. |
| Google Drive | Implementado (carpeta con el selector oficial de Google, subida reanudable por bloques de 8 MiB, reintento sin volver a renderizar). **No probado contra Google**: faltan las credenciales públicas del selector (ver `google-drive-configuracion.md`). La subida se probó con un Drive simulado (3 pruebas: bloques, reanudación tras corte, cancelación). **No es una transferencia directa desde un servidor**: el vídeo se renderiza en tu navegador, no existe en ningún servidor nuestro, y se sube desde un temporal local. |
| Biblioteca de Cerebro Studio | Funciona; muestra cuota libre y máximo por archivo (50 MB en Supabase gratuito). |
| OneDrive, Dropbox | No disponibles: requieren registrar una aplicación en cada servicio. |

Sin R2 ni infraestructura de pago activada. Los vídeos de más de 50 MB solo caben en «Carpeta/disco», «Descargar» o Drive.
