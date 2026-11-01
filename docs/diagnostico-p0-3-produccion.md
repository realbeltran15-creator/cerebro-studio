# Diagnóstico P0.3 — Editor / Montaje automático / Editar con mi estilo (local, 0 €)

Método: lectura de código por un agente de solo lectura (no ejecutó nada con efectos) + verificación de las correcciones por mí. Hallazgos **por lectura**, no reproducidos en navegador. Ningún test existente cubría los defectos listados.

## Corregidos en esta ronda
| # | Sev. | Hallazgo | Corrección | Prueba |
|---|---|---|---|---|
| 1 | Alta | Miniaturas: un asset borrado (404) se pedía en bucle sin fin con cada respuesta (`manual/page.tsx` efecto de `thumbs`) | Cada id se pide una sola vez (`thumbsTried`) y no se actualiza el estado si no hay nada nuevo | tsc/build (efecto de UI, sin test unitario) |
| 10 | Baja-media | `findSilences`: `Math.max(...rms)` revienta la pila con ~200.000 ventanas (horas de metraje) y rompe el render | Bucle | test con 300.000 ventanas |
| 12 | Baja | «Crear montaje» seguía activo tras crearlo (un clic = otro borrador); «como copia» del conflicto con doble clic = dos copias | Botón desactivado tras crear; guarda en la copia | tsc/build |
| 4 | Media | Errores de base de datos crudos en el guardado en la nube y la copia | `friendlyDbMessage` (resto de pantallas: pendiente) | tests de la función |

## Abiertos (con decisión o permiso necesarios)
- **2 (media, pérdida de datos):** «Guardar la mía encima» sobrescribe la otra pestaña y solo guarda *mi* versión como punto de recuperación; la ajena se pierde salvo que esa pestaña haya escrito una versión. Propuesta: leer y archivar la versión remota antes de forzar.
- **3 (media):** navegar con los enlaces internos del encabezado (sin `beforeunload`) pierde cambios si el autoguardado está desactivado o en error.
- **5 (media, cuota):** `/api/transcribe` comprueba «ya existe subtítulo» con select no atómico y sin índice único: dos pestañas gastan dos veces la cuota (Groq gratis ≈20/día) y luego `maybeSingle()` falla en silencio. Corrección limpia = índice único (migración, no autorizada); mitigación sin migración posible.
- **6 (media):** «Editar con mi estilo» descarga el vídeo entero a memoria sin límite ni `r.ok`.
- **7 (baja-media):** «Generar voz/imagen/vídeo» en `/editor` llama a `/api/providers/voice|image|video` que **no existen** (404); muestra un aviso de coste y luego falla. Decisión: eliminar el botón o implementar la ruta con confirmación de gasto.
- **8:** cancelar una exportación rápida se registra como `failed`. **9:** los botones .srt/.vtt aparecen aunque «Subtítulos incrustados» esté apagado y un cue con línea en blanco corrompe el SRT. **11:** el borrador local (IndexedDB) usa solo `jobId` como clave y se pisa entre pestañas. **13:** decodificación serial de voces y serialización del historial local. **14:** `fast-export` omite en silencio clips de audio sin pista; «Renderizar» puede arrancar mientras corre el autotest de 20 s.

## Áreas sólidas (con evidencia)
Exportación de un solo vuelo (`busyRef` síncrono), guardado en la nube serializado con bloqueo optimista (`updated_at`) y puntos de recuperación, puerta de gasto real en `/api/studio/generate` (confirmación + topes), límites de tamaño/duración de exportación y borrador local nunca aplicado en silencio.

## Validación
Ver informe en el chat (tsc, suite, build).
