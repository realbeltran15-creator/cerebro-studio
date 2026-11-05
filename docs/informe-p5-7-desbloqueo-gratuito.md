# Informe P5.7 — Desbloqueo gratuito de módulos (0 €)

## Mejoras implementadas
1. **Plantillas**: los selectores ya filtraban por tipo; se añade una defensa en el montaje (`safeAssign`) que descarta asignaciones incompatibles antes de crear el borrador, y `tests/template-slot-compat.test.ts` (3 pruebas). Las asignaciones se reinician al cambiar de proyecto o plantilla.
2. **Miniaturas**: antes solo se podía poner texto sobre miniaturas generadas con IA (de pago), y no había forma de usar una imagen propia. Ahora las imágenes subidas a la Biblioteca aparecen como «Imagen tuya (base gratis)» y se les compone el texto exacto en el navegador (16:9, 9:16 o 1:1) y se guarda como miniatura nueva (el original no se toca). Probado de principio a fin (E2E M24, sin hosts externos, persiste tras recargar). Estado: Bloqueado/parcial → **Parcial operativo** (variantes con IA siguen exigiendo proveedor).

## Evaluación de los módulos restantes
| Módulo | Sin servicios externos | Requiere | Proveedor gratuito posible | Valor / acción |
|---|---|---|---|---|
| Música y sonidos | Subir audio con licencia (probado) | Clave para IA / bancos | Freesound (API gratuita, uso no comercial; límites citados por terceros: 60/min y 2.000/día, sin confirmar en documentación oficial) | Medio; integrar solo si el uso es no comercial |
| Miniaturas | Texto sobre imagen propia (hecho) | Proveedor de imagen para variantes | Pexels API (verificado en su documentación: gratis, 200 solicitudes/hora y 20.000/mes por defecto, enlace/atribución obligatoria) para fondos | Alto; fondos de stock como base |
| Shorts / Reels | Propuesta de momentos con transcripción pegada | Transcripción automática | Transcripción local (p. ej. Whisper) no verificada ni medida aquí | Medio |
| Shorts diarios | Nada de la cadena completa | Gemini + Cloudflare + Radar | Sin alternativa verificada | Bajo |
| Estudio | Reutiliza montaje/miniaturas locales | Claves de pago para generación | — | Medio: enlazar con Editor y Miniaturas |
| Investigación, Radar, Oportunidades, Automatizaciones | — | `YOUTUBE_API_KEY` | YouTube Data API v3: gratuita, cuota por defecto 10.000 unidades/día por proyecto de Google Cloud; `search.list` cuesta 100 (fuente secundaria: ppc.land; contrastar con la documentación oficial antes de decidir) | Alto; con ~100 búsquedas/día es suficiente para uso personal |
| YouTube | — | OAuth de Google | Misma API, gratis | Alto, pero exige crear credenciales (acción de Jesús) |
| Analytics | — | OAuth con `yt-analytics.readonly` (verificado en referencia oficial: toda petición debe estar autorizada) | YouTube Analytics API, sin coste conocido | Alto tras conectar canal |
| Instagram y TikTok | — | Apps OAuth y auditoría TikTok | Ninguno | Bajo |
| Virtual Influencer | — | Modelos (NOT_CONNECTED) | Ninguno | Bajo |
| Añadir materiales | Subida desde dispositivo | Drive / Atajo iOS credenciales | — | Ya útil |

«Gratis» no significa «sin riesgo»: las cuotas se agotan y las claves/OAuth las debe crear Jesús; no se ha activado ninguna conexión ni consulta externa.

## Costes y límites comprobados
Gasto real: 0 €. Verificados en documentación oficial: Pexels (límites y atribución), YouTube Analytics (OAuth). Sin verificar en fuente oficial: cuotas de YouTube Data y Freesound.

## Dependencias pendientes
Claves/credenciales de YouTube (Data y OAuth), alojamiento gratuito aislado para la beta, aplicar (en su día) el GRANT de `channel_connections`.

## Próximas tres acciones de mayor impacto
1. Que Jesús cree una clave de YouTube Data API (gratis) para desbloquear Investigación, Radar, Oportunidades y Automatizaciones (4 módulos); yo añadiría un contador local de cuota.
2. Integrar Pexels como fuente de fondos en Miniaturas y Editor (con atribución), tras autorización de la clave.
3. Estudiar transcripción local para Shorts/Reels y comprobar su rendimiento en la RAM disponible.
