# P1.2 — Virtual Influencer, Biblioteca/Almacenamiento, Shorts y Fábrica (local, 0 €)

Criterio transversal aplicado: ninguna salida se presenta como completada sin verificarla.

| Módulo | Estado real | Defectos hallados → corrección | Pruebas (R=real, S=simulado) | Puntuación interna* |
|---|---|---|---|---|
| Virtual Influencer | API de trabajos con reclamo atómico, preflight de presupuesto/identidad, revisión humana obligatoria | (1) Reserva de gasto leer‑modificar‑escribir: dos trabajos simultáneos podían perder una suma → `reserveSpend` con concurrencia optimista (reintenta; si falla devuelve el trabajo a la cola). (2) Trabajo «running» abandonado quedaba bloqueado para siempre → se cierra como fallido tras 10 min sin re-ejecutar (el proveedor pudo cobrar) | S (BD en memoria): ambos tests FALLAN con el código anterior y pasan ahora. **Limitación documentada:** la consistencia visual del personaje depende de generación externa de pago; no se ha probado ni se declara resuelta con tests de metadatos | 84 |
| Salida de proveedores («completado» verificado) | `persistGeneratedAsset`/`persistImportedAsset` guardaban cualquier byte | Un error JSON/HTML con HTTP 200 o un archivo vacío quedaban como recurso «completado» → `verifyGeneratedBytes` (cabecera de imagen/vídeo; audio sin texto ni vacío) | R: 3 tests de la función; sin llamadas a proveedores | 88 |
| Biblioteca | Borrado seguro: comprueba publicaciones, montajes, renders y derivados, y relee antes de borrar | La comprobación de uso leía como máximo 1000 montajes/500 publicaciones: con más, un material en uso podía parecer libre → lectura paginada completa (`fetchAllPages`, falla en vez de truncar) | R: paginación (1234, múltiplo exacto, error, tope) | 90 |
| Almacenamiento | Aislamiento por propietario (`assertOwnPath` + filtro owner), subidas multipart con limpieza de huérfanos | Sin defectos nuevos | Tests existentes (storage, multipart, cleanup); no se tocó almacenamiento real | 88 |
| Prueba integral | importar→material→montaje→MP4→original→reabrir | — | R: hash del original idéntico tras 3 exportaciones; el montaje guardado como JSON y releído produce los mismos fotogramas (framemd5); S: BD/almacenamiento | — |
| Shorts/Reels/TikTok | Reencuadre por `focusX`, formatos 9:16/1:1/16:9 | Sin defectos: el tamaño sale del plan, el encuadre es ajustable (0 = izquierda, 1 = derecha), no deforma (cuadrado sigue cuadrado) y el original no cambia | R (FFmpeg): 4 tests. No cubierto: detección automática de rostros (no existe) | 87 |
| Fábrica de Shorts | Solo gratis, nunca publica, un Short/día, rollback si falla; índice único en BD | Si dos ejecuciones se solapaban, la perdedora informaba «storage_failed» → ahora `already_prepared_today` (ya deshecha) | R: función; el resto ya cubierto por 55 tests. No se activó worker, cron ni automatización | 90 |

*Puntuación interna orientativa, no medida por usuarios.

Validación: tsc limpio; 148 ficheros / 1458 tests OK (13 omitidos); next build OK. Coste 0 €. Sin push, sin migraciones aplicadas.
Pendiente: pruebas en navegador real; Biblioteca/Storage contra Supabase real; SQL propuestos sin aplicar.
