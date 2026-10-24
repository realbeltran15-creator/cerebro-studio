# Exportación: por qué se paraba en segundo plano y qué se ha hecho

Estado: octubre de 2026, rama `fase1-seguridad`. Nada de pago activado.

## Cómo funciona la exportación rápida

`lib/editor/fast-export.ts` dibuja cada fotograma en un canvas y lo codifica con WebCodecs a través de Mediabunny. No espera al tiempo real ni usa `requestAnimationFrame`. El audio se mezcla con `OfflineAudioContext` en trozos de 10 s. El archivo se monta en memoria y, al terminar, se sube a la Biblioteca o se descarga.

## Qué la frena o la para (según el código, las pruebas y la documentación de Chrome)

| Causa | Efecto | Estado |
|---|---|---|
| Temporizadores en pestañas ocultas: Chrome los limita a 1 por segundo y, tras 5 min, a 1 por minuto | Mediabunny ya usa sus propios temporizadores en un Worker para evitarlo (`unthrottledTimerWorker`). El bucle de exportación no usa temporizadores. | No es la causa |
| Congelación de pestañas ocultas: Chrome 133+ con Ahorro de energía, tras 5 min oculta y en silencio | Todas las tareas se detienen y la exportación queda parada hasta volver a la pestaña. No se pierde nada. | Mitigado, no evitable al 100 % |
| Panel del navegador de Claude oculto (pruebas) | Ese panel deja de dibujar y de ejecutar cuando no está a la vista. Es lo que paró la exportación de prueba a los 4,2 s. | Es un límite del entorno de pruebas, no de la app |
| Cerrar o recargar la pestaña | El vídeo solo existe en la memoria de la pestaña hasta que se guarda. | Ahora se pide confirmación |
| Exportación «solo descargar» | Al terminar intentaba guardar `output_manifest`, una columna que no existe en la base real. El trabajo no quedaba como completado y el error se ignoraba. | **Corregido** |

Fuente sobre la congelación: [Chrome for Developers, «Freezing on Energy Saver»](https://developer.chrome.com/blog/freezing-on-energy-saver). Una pestaña no se congela si tiene un Web Lock que otra pestaña está esperando, si reproduce sonido, si usa cámara o micrófono, o si lleva menos de 5 min oculta.

## Protecciones nuevas (`lib/editor/export-guard.ts`, gratuitas)

- **Web Lock `cerebro-export`** mientras dura la exportación. Si hay dos exportaciones en dos pestañas, la segunda espera el candado y Chrome no congela la primera. Con una sola pestaña, Chrome puede congelarla igualmente en Ahorro de energía después de 5 min oculta.
- **Pantalla encendida** (Screen Wake Lock) mientras la pestaña está a la vista, para que el equipo no se suspenda a mitad.
- **Confirmación antes de cerrar o recargar** la pestaña.
- **Avisos en el panel**:
  - «La pestaña está oculta…».
  - «La pestaña estuvo oculta X s; la exportación continúa…».
  - Si no avanza en 20 s, dice si la causa es que la pestaña está oculta (sigue sola al volver) o propone cancelar y probar el modo en tiempo real.
- Todo se suelta al terminar, al cancelar o si hay un error.

## Pruebas reales

- `tests/export-guard.test.ts` (5 pruebas): candados, confirmación al cerrar, tiempo oculto, detección de parada y navegadores sin estas APIs.
- Sección 33 de `scripts/browser-tests.mjs`, en Chromium real con el editor real:
  - el candado aparece al exportar y desaparece al terminar;
  - se pide confirmación al cerrar;
  - los avisos funcionan al ocultar y volver;
  - el archivo exportado se analiza con **ffprobe**: vídeo 1280×720 con audio y 13 s de duración.
- Las secciones 24 y 25 ya comparaban la exportación con el visor en los mismos instantes: capas, fotos, dos músicas, voz, efecto, transiciones a mitad y automatización de volumen.

## Exportaciones largas sin la pestaña abierta (diseño, **no activado**)

Una exportación en el navegador siempre depende de que la pestaña siga viva. Para sesiones largas (por ejemplo 90 min de lo-fi), la única solución completa es renderizar en un servidor:

1. El editor guarda el montaje como hoy y crea un `render_jobs` con estado `queued`.
2. Un trabajador con ffmpeg hace lo siguiente:
   - lee el montaje;
   - descarga los materiales con enlaces firmados;
   - reproduce el mismo dibujo (el código de `lib/editor/scene.ts` y `draw.ts` puede ejecutarse en Node con un canvas) o traduce el montaje a un grafo de filtros de ffmpeg;
   - sube el resultado a R2 y marca el trabajo como `completed`.
3. El editor muestra el progreso leyendo `render_jobs`. Se puede cerrar el navegador.

Dónde ejecutar el trabajador:

- Las funciones de Vercel no sirven, por el límite de tiempo de cada ejecución.
- Opciones con coste mensual: un servidor pequeño o una cola de trabajos en segundo plano.
- Opción gratuita: **el propio PC** con ffmpeg y un script que consulte la cola. Funciona con el navegador cerrado, pero solo con el PC encendido.

No se ha contratado ni activado nada. Antes de elegir, se presentarán los precios comprobados.
