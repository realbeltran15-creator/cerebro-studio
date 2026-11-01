# Informe consolidado P0–P3 — Cerebro Studio (rama fase1-seguridad)

Fecha: 2026-11-01. Presupuesto gastado: 0 €. Producción, Supabase, cron, credenciales y automatizaciones: sin tocar.
Leyenda de evidencia: **[U]** test unitario/lógica · **[F]** FFmpeg real en el sandbox · **[N]** navegador real (Chromium) con Supabase **simulado** · **[P]** Preview real sin sesión · **[E]** análisis estático · **[—]** sin verificar. «Código desarrollado» ≠ «funcionalidad verificada».

## 1. Estado de las ramas
- GitHub `fase1-seguridad`: hasta 79cfe00 (14 commits subidos con autorización de Jesús). Preview de Vercel de 79cfe00: READY.
- Solo locales (sin push): 0857f38 (estados), d9153ff (P3 informe/rutas/contraste), 08157e3 (carga diferida), 8367ec8 (foco en diálogos), 46be438 (pruebas de navegador) y los commits siguientes. Nuevos pushes requieren autorización expresa.

## 2. Funcionalidades terminadas y verificadas (con el alcance indicado)
- Render de vídeo offline (montaje con recortes, voz, música, mezcla, fades, formatos 9:16/1:1/16:9) — **[F]** MP4 real, originales intactos, cancelación, reintentos, fallo de FFmpeg, destinos simultáneos.
- Integridad de datos de guion/storyboard/escenas (orden, concurrencia en cliente, confirmación al borrar) — **[U]**; en navegador con BD simulada **[N]**.
- Importación de materiales: clasificación, huella, comprobación de cabecera real (JPEG/PNG/GIF/WebP/WAV/MP4-MOV/WebM/MP3/OGG/FLAC) — **[U]**, subida en navegador **[N]**.
- Verificación de bytes generados por proveedores antes de guardar, lecturas paginadas que fallan en vez de truncar, calendario sin fechas inválidas (4 zonas horarias) — **[U]**.
- Estados comunes (Preparado / Pendiente de aprobación / En ejecución / Completado y verificado / Fallido / Cancelado / Incierto) en YouTube, redes, influencer, automatizaciones, Shorts y renders del editor — **[U]** (13 tests). Nada «verificado» sin id/archivo.
- Editor manual y exportación en navegador: **[N]** 552 comprobaciones pasan (undo/redo, divisiones, pistas, importadores, render panel, Shorts con aprobación y subida simuladas). Ver §6 para los fallos abiertos.
- Accesibilidad estática: nombres accesibles, teclado en elementos clicables, foco en diálogos del editor, contraste WCAG AA de tokens — **[E]**/**[U]**. No hay conformidad WCAG 2.2 AA demostrada.
- Rutas internas: 144 referencias, 0 rotas — **[E]**.
- Preview 79cfe00 sin sesión: pantallas protegidas redirigen; generate/publish solo POST; cola/cron/proveedores 404 — **[P]**.

## 3. Funcionalidades parciales
- Gasto: reserva de gasto en memoria (una sola instancia) **[U]**; la reserva atómica en BD (`reserve_generation_spend`) es SQL propuesto, no aplicado ni probado. Con varias instancias el límite NO está garantizado.
- Transcripción: bloqueo en memoria; el bloqueo en BD está propuesto y no aplicado.
- Influencer virtual: cola, reintento y gasto probados con lógica; la consistencia visual depende de generación externa de pago (no probada).
- Exportación en navegador (WebCodecs/MediaRecorder): probada en Chromium del sandbox [N]; no probada en los navegadores/equipos reales de Jesús.
- Rendimiento: medido el JS inicial por ruta (mediana ≈ 330 KB; editor/manual 869 KB tras la carga diferida de diálogos). Sin medición de memoria ni de renders en navegador.

## 4. Funcionalidades desconectadas (por diseño, honestas en la interfaz)
- Generar voz/imagen/vídeo desde el editor (`GENERATION_CONNECTED=false`; las rutas /api/providers/* no existen).
- Cola de renders/colas de publicación en servidor: endpoints desactivados por defecto; no existe proceso trabajador.
- OAuth de Google en Producción y reconexión de YouTube: pendientes de decisión de Jesús.

## 5. Integraciones simuladas / no probadas en real
- Supabase (RLS, PostgREST, Auth): simulado en las pruebas de navegador; solo SQL en PostgreSQL local desechable. Ninguna prueba contra la base real ni con sesión real.
- YouTube, Instagram, TikTok, Dropbox, Drive, proveedores de pago: simulados; **ninguna llamada real** a publicación o pago. Las rutas de Instagram/TikTok solo tienen pruebas estáticas y de lógica, sin pruebas funcionales de ruta.
- Analytics de YouTube y retención a 7 días: datos simulados.

## 6. Pruebas reales realizadas y fallos abiertos
- FFmpeg/FFprobe 6.1.1 real (varias suites E2E de render, audio, vertical, materiales).
- `npm run test:browser` (Chromium): estaba sin ejecutarse por el entorno; reparado el arnés (variables de entorno que faltaban, selectores y confirmaciones dentro de la tarjeta que habían cambiado, cabeceras de archivo válidas por la nueva comprobación, `like()` en el simulador). Resultado actual: **552 comprobaciones OK**, 3 fallos y 1 parada **sin diagnosticar**:
  1. `render panel: a VP9/WebM render is flagged as not Instagram-ready…` (falla también en el commit e73cc37, anterior a esta sesión).
  2. `viewer: dragging the corner handle makes the layer bigger` («Tamaño 43 %»).
  3. `verify (realtime): the export shows the same picture as the preview…` (imagen exportada ≠ vista previa en algún instante).
  4. Parada en `properties: a video adds its own tools (…velocidad…)` (no se encuentra visible el control «Velocidad»; puede ser un cambio de interfaz o un defecto).
  Pueden ser pruebas desfasadas o defectos reales: no se sabe. Tratar como P1 hasta diagnosticar.
- Defecto real encontrado y corregido: Shorts mostraba el aviso/error de la acción dos veces (y lo anunciaba dos veces a lectores de pantalla).

## 7. Migraciones SQL propuestas y NO aplicadas (sin probar contra la base real)
`supabase/pending/`: `storyboard_from_script_rpc`, `scenes_concurrency_and_reorder`, `subtitle_unique_per_source`, `transcription_locks`, `reserve_generation_spend` (cada una con su rollback). Además `supabase/migrations/20261018120000_server_owned_security.sql` figura como «PREPARED, NOT APPLIED» en su cabecera: comprobar su estado real antes de asumir nada. Orden de despliegue de esa migración: primero el código con la clave de servicio, después el SQL.

## 8. Funciones que podrían generar gasto
`/api/studio/generate` (proveedores de pago; con tope y reserva en memoria), trabajos del influencer virtual (reserva optimista en BD de la app, no atómica entre instancias), Shorts «modo Veo/Flow» por instrucción. En el Preview sin sesión no son alcanzables (405/redirección). Gasto actual comprobado: 0 €.

## 9. Funciones de publicación
YouTube (borrador → aprobación → subida privada), Instagram (Reels) y TikTok (aprobación + publicación), Shorts (subida privada). Todas exigen aprobación explícita; un vídeo con montaje incompleto no se puede preparar/subir; interrupciones quedan «Incierto». Ninguna se ha ejecutado de verdad.

## 10. Clasificación de lo pendiente
- **P0** (seguridad, pérdida de datos, gasto o publicación accidental): gasto no atómico entre instancias; migración de seguridad de propiedad del servidor no verificada como aplicada; bloqueos de transcripción en BD sin aplicar.
- **P1** (funciones principales): los 3 fallos y la parada del navegador (§6); pruebas funcionales de rutas Instagram/TikTok; recorrido completo con sesión real sin probar.
- **P2** (UX/rendimiento): medir memoria y renders; revisión móvil con navegador; pasar de lectura a conformidad WCAG con lector de pantalla/axe.

## 11. Propuesta de beta mínima (sin proveedores de pago)
Crear proyecto → guion → storyboard → editor manual → exportar MP4 local → Biblioteca → recuperar/reabrir. Con generación de pago, colas y publicación **desactivadas**. No declarar la beta lista hasta: (a) diagnosticar los 4 puntos de §6, (b) que Jesús pase el guion `guion-prueba-manual-recorrido.md` con su sesión en el Preview, (c) decidir/aplicar (con autorización) las migraciones P0 en una rama de pruebas de Supabase.
