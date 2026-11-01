# P2.6 — Estados comunes en la interfaz

Capa de presentación `lib/operation-presentation.ts` sobre los estados ya guardados (sin migración). Estados: Preparado / Pendiente de aprobación / En ejecución / Completado y verificado / Fallido / Cancelado / Incierto.

Conectada a: YouTube y redes sociales (publicationView), producción del influencer (generationJobView), automatizaciones (automationRunView), Shorts (shortItemView).

Reglas (probadas, 11 tests, TODAS son pruebas de lógica, no de navegador):
- «Publicado» sin identificador del vídeo, o con comprobación en la plataforma que no coincide → Incierto.
- Publicación interrumpida (vuelve a «aprobado» con `interruptedAt`) → Incierto, no Preparado.
- Ejecución de automatización «en curso» más de 15 min → Incierto; nunca se convierte en completada por el paso del tiempo.
- Trabajo del influencer «aprobado» sin archivo guardado → Incierto.
- Fallos, cancelaciones y descartes se muestran aparte.

Límites: no hay pruebas de interfaz en navegador real; Estudio/exportación del editor y la cola de renders siguen con sus etiquetas propias.
