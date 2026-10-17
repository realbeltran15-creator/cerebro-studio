# Investigación: estimador de ingresos y fuentes de datos

## Estimador (`lib/research/revenue.ts`)
`ingreso = visualizaciones ÷ 1 000 × RPM`, siempre un **rango** (bajo – central – alto) de **ingresos publicitarios estimados**.
- **Dato público (YouTube Data API):** visualizaciones, fechas, suscriptores, visualizaciones totales del canal.
- **Estimado:** el RPM (estudios de sector por nicho, con fecha, método y confianza; Shorts = 3–14 % del RPM de un vídeo largo) y, si la investigación está orientada a un mercado, un ajuste por el precio relativo de la publicidad de ese mercado (limitado a ×0,4–×2; baja la confianza un nivel; **no** afirma conocer la audiencia).
- **Desconocido, nunca inventado:** RPM real de cualquier canal, países de los espectadores, patrocinios, afiliados, membresías, mercancía.
- **Niveles:** vídeo (sus visualizaciones), nicho (vídeo típico = mediana de los relevantes de hace 7–60 días, mínimo 3; vídeo que funciona = mediana de los más vistos del año, mínimo 5; escenarios de 4/8/12 vídeos al mes), canal (vida = visualizaciones totales públicas; últimos 30 días = visualizaciones acumuladas de los vídeos publicados en esa ventana; el país declarado del canal no se usa como mercado).
- Cada estimación muestra fórmula con números, supuestos, fuentes y confianza; un nicho sin estudio sale **DESCONOCIDO** (puedes poner tu RPM).

## Fuentes (`lib/research/sources/registry.ts`)
| Fuente | Estado | Aporta | Para conectarla |
|---|---|---|---|
| YouTube Data API v3 | **Conectada** (gratis) | datos públicos de vídeos y canales | — |
| Estudios de RPM (AIR Media-Tech y guías de terceros) | **Incluida** como tabla con fecha | RPM por nicho, Shorts, precio relativo por país | revisar la tabla periódicamente |
| YouTube Analytics API | Pendiente (gratis, **solo canales propios**) | ingresos y RPM reales, país de la audiencia de TUS canales | iniciar sesión con la cuenta propietaria y autorizar `yt-analytics.readonly` y `yt-analytics-monetary.readonly`; cliente OAuth en Google Cloud |
| Social Blade (Business API) | Pendiente (**de pago**) | histórico por día de suscriptores/visualizaciones y sus estimaciones de ingresos | cuenta con acceso a la Business API y créditos (el precio no es público; se ve en su panel), aceptar sus condiciones y poner la clave como variable de entorno del servidor |
| Google Trends | Descartada por ahora | interés relativo de búsqueda | acceso programático oficial |

No se hace scraping de Social Blade ni de ninguna web sin permiso. Con su histórico se podrían calcular visualizaciones por periodo de canales ajenos, hoy imposible solo con YouTube Data API; no se contrata sin tu autorización.

## Validación real
`YOUTUBE_API_KEY=… npm run research:validate` ejecuta los tres casos (ETF Sparplan DE, first time buyer GB y US) más una medición de crecimiento y un segundo intento que no debe llamar a YouTube: ≈ 714 unidades y 7 búsquedas. Escribe `research-output/validation-<fecha>.md/.json` con los vídeos aceptados/descartados para revisarlos a mano. `-- --selftest` ejecuta el script con datos SIMULADOS solo para comprobar que funciona (no es una validación).
