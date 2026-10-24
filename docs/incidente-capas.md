# Incidente: capas desaparecidas en «Prueba técnica — multipista (Claude)»

Investigado el 24-10-2026. Proyecto de prueba (no personal). No se ha modificado ningún dato para investigarlo: solo lecturas
(registros de la API de Supabase, la fila del montaje, sus puntos de recuperación y la copia local del navegador).

## Hechos comprobados (registros de la API, hora UTC)

| Hora | Qué |
|---|---|
| 22:41:51 | Se crea el montaje. |
| 22:42:13 – 22:44:18 | 10 guardados automáticos (uno cada pocos segundos, como debe ser). |
| 22:44:18 → 09:04:25 | **Ningún guardado durante 8 h 20 min**, aunque después de las 22:44 se hicieron cambios (voz movida a 4 s, música con fundidos y automatización, un título). |
| 09:04:25 | Se guarda el montaje con esos cambios posteriores **pero sin las dos capas** (las pistas de superposición sí están, en el orden cambiado con «Subir»). |

- Las dos capas existían después de «Subir» (comprobado en el visor en aquel momento).
- Ningún punto de recuperación las contiene: el de las 00:42 (hora local) es anterior a crearlas y el de las 11:04 ya no las tiene.
- El guardado usa control de concurrencia (`updated_at`) y ninguna petición fue rechazada: no hubo dos sesiones pisándose.
- Con capas de otros proyectos, guardar y reabrir funciona (prueba reproducida); la serialización no descarta capas.

## Causas

- **Confirmado (por el código):** el guardado automático espera mientras hay un arrastre abierto en la línea de tiempo o el visor, y
  un arrastre solo terminaba si se soltaba el botón *dentro* de la línea de tiempo. Si la liberación se pierde, el guardado automático
  queda en espera indefinida y, además, mover el ratón por la línea de tiempo después volvía a aplicar el arrastre desde su foto
  inicial, deshaciendo lo editado desde entonces. Es compatible con los 8 h 20 min sin guardar.
- **No explicado:** qué acción quitó exactamente las dos capas. No se ha podido reproducir. No se declara resuelto.

## Protecciones añadidas

1. Un arrastre termina con cualquier liberación (también fuera de la línea de tiempo o de la ventana) y, si llega un movimiento sin botón
   pulsado, se cierra en vez de continuar desde su foto antigua (línea de tiempo, transiciones y visor).
2. El guardado automático no espera a un arrastre de más de 20 s sin botón pulsado.
3. **Antes de guardar una versión que quita clips, capas, textos o sonidos, se guarda la versión anterior como punto de recuperación
   «Antes de quitar elementos»** (se conservan 30 aparte de los demás). Así nada que desaparezca, por error o a propósito, se pierde.
4. Aviso visible cuando hay cambios sin guardar en la nube durante más de un minuto, con «Guardar ahora».

Prueba de navegador 32 y prueba unitaria de `removedItems`.
