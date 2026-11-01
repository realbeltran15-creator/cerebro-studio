# Beta privada — alcance, bloqueantes y funciones desconectadas
Fecha: 2026-11-01 · Presupuesto: 0 € · Criterio: guardar, recuperar y proteger los proyectos de un usuario real, sin servicios de pago.

## Funciones que se pueden usar SIN servicios de pago (propuesta de beta)
Prioridad de la beta: crear proyectos → guiones → storyboards → importar materiales → editar → exportar MP4 → recuperar trabajos.
- Proyectos, Guiones (versiones, secciones), Storyboard y escenas (reordenar/borrar), Flujos de producción, Calendario.
- Añadir materiales y Biblioteca/Almacenamiento (Supabase Storage, límite gratuito de 50 MB por archivo y ~1 GB; R2 solo si Jesús lo configura).
- Editor automático, manual, «con mi estilo», plantillas y auto-edición (en el navegador, sin coste); exportación MP4/WebM con FFmpeg local/navegador; puntos de recuperación (versions/).
- Radar y Oportunidades con la API oficial de YouTube (cuota gratuita), Costes (solo lectura).

## Desconectadas / fuera de la beta (marcadas «Parcial» o «Preparado para integración» en la app)
- Generación de pago: Estudio IA (imagen/vídeo), Música/SFX, Miniaturas generadas, Influencer IA: sin probar con claves reales; deben quedar apagadas.
- Publicación: YouTube (requiere OAuth Google en Production + reconexión), Instagram/TikTok (OAuth sin conectar), Fábrica de Shorts, Campañas, Automatizaciones (cron/trend_watch no se tocan).
- Analytics de YouTube (depende de OAuth).

## Bloqueantes reales antes de invitar a un tercero
| # | Nivel | Bloqueante | Quién |
|---|---|---|---|
| 1 | P1 | Recorrido manual autenticado en Preview con una sesión real (`docs/guion-prueba-manual-recorrido.md`) | Jesús |
| 2 | P1 | Supabase Auth real (login/registro/refresh) y Storage real (subida/descarga/borrado, políticas del bucket) sin probar; solo hay sustitutos locales | Requiere entorno Supabase aislado (coste no demostrable: decisión de Jesús) |
| 3 | P1 | Aplicar las 5 propuestas SQL (`supabase/pending`) a Supabase real: sin autorización; la app funciona sin ellas, pero conserva las carreras que corrigen | Jesús |
| 4 | P1 | 8 commits locales sin push (no se sube sin autorización nueva) | Jesús |
| 5 | P2 | Riesgo intermitente de exportación en tiempo real vs vista previa (no reproducido) | Medir en navegador real |
| 6 | P2 | WebM en navegador y conversión local a MP4 sin ejecutar; Instagram/TikTok sin pruebas funcionales | Pendiente |
| 7 | P2 | Límite de bytes por parte firmado (content-length) y firmas SigV4 rechazadas por servidor: no verificables con sustitutos S3 | Verificar con R2/Supabase real |
