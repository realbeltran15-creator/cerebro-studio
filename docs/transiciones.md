# Transiciones entre clips

Una transición pertenece al **corte** entre dos clips consecutivos de la pista principal. Se guarda en el clip que termina (`transition`, `transitionMs`, `transitionOpts`), pero su efecto es compartido: durante su ventana los dos clips están en pantalla.

## Modelo temporal

La transición no mueve ningún clip ni cambia la duración del proyecto. Ocupa una ventana alrededor del corte, según `transitionOpts.align`:

| Alineación | Ventana | Clip A (sale) | Clip B (entra) |
|---|---|---|---|
| `center` (por defecto en transiciones nuevas) | mitad antes y mitad después del corte | sigue después de su final | empieza antes de su inicio |
| `before` (sin `align`: proyectos antiguos) | termina en el corte | solo su cola | muestra el material anterior a su entrada |
| `after` | empieza en el corte | sigue después de su final | solo su principio |

Un clip usa **material real del archivo** (más allá de su salida o antes de su entrada) cuando existe: `sourceDurationMs` (duración del archivo, se lee al abrir el montaje y el motor la sondea con ffprobe) y `trimInMs` permiten calcularlo. Las fotos siempre tienen material. Donde no hay material, el clip mantiene su último/primer fotograma, y **el editor lo avisa**: el panel de Propiedades indica cuántos segundos faltan en cada clip y ofrece «Ajustar la duración al material disponible» o cambiar la alineación; el icono de la línea de tiempo muestra ⚠ y la banda se dibuja discontinua. Nada se limita ni se congela sin avisar.

La duración efectiva nunca supera la de ninguno de los dos clips, y dos ventanas consecutivas no se pisan dentro de un mismo clip (`transitionWindow`).

## Imagen y sonido

`frameAt` dibuja A debajo y B encima con el cálculo de `transitionFrame` (disolución cruzada: A al 100 % y B de 0 a 100 %, con la curva elegida). El sonido propio de los vídeos sigue la misma ventana (`videoVoices`): A baja y B sube durante toda la ventana. Vista previa, exportación en el navegador y motor offline usan este mismo código.

## Interfaz

- El icono está exactamente sobre la unión, no dentro de ningún clip; al seleccionarlo se marcan los dos clips y la banda muestra la ventana (arrastra sus bordes para alargarla o acortarla; en «centrada» crece por los dos lados).
- Propiedades: participantes, tipo, duración (deslizador y campo numérico), punto de alineación, dirección, intensidad (zoom, desenfoque, destello), curva, previsualización centrada en el corte, restablecer y quitar.

## Compatibilidad

`align` y `sourceDurationMs` son opcionales. Un proyecto guardado antes se abre igual que antes (`before`). No se migra ni se borra nada.

## Pruebas

- `tests/transition-overlap.test.ts`, `tests/transition-edit.test.ts` (mover, recortar, eliminar, deshacer/rehacer, guardar y recuperar, continuidad en todas las alineaciones y curvas), `tests/transition-limits.test.ts`.
- `npm run test:transitions`: dos vídeos reales y distintos, disolución cruzada centrada, comparada fotograma a fotograma (siete instantes alrededor del corte) entre el motor, el visor y el MP4 de la exportación rápida del navegador.
- Sección 35 de `scripts/browser-tests.mjs`: icono en la unión, clips marcados, alineaciones, avisos de material, restablecer, previsualizar.
