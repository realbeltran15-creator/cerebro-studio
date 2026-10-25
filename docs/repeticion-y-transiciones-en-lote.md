# Repetición masiva y transiciones en lote

**Repetir…** (botón de la barra, del inspector y de la paleta) crea N instancias independientes de un clip, todas con el mismo archivo
(`visualAssetId`). No se copia ningún medio; una instancia pesa ~0,4 KB en el montaje (620 clips de 30 s = 280 KB; 3000 clips = 1,3 MB).
Cada una tiene su id, posición y ajustes, así que se puede editar, recortar o cambiar sola. Un bloque de repetición «virtual» se descartó
porque obligaría a expandirlo para tocar una sola repetición.

* Modo «veces»: 10 / 100 / 200 / 300 o cualquier número; el original cuenta como la primera.
* Modo «hasta una duración»: 60 / 90 / 120 / 180 / 300 min o personalizada. Cuenta lo que se pierde en cada corte (material cedido a la
  transición) y, si se pide, acorta el último clip para llegar exacto sin tocar su transición.
* «Unir con una transición» reutiliza la misma configuración que las transiciones en lote.
* Vista previa antes de confirmar (nº de clips, duración final, material recortado, avisos). Un solo Ctrl+Z lo deshace todo.

**Transiciones en lote…** aplica o quita una transición en: todos los cortes, los seleccionados, un rango, o cada N. Elige tipo, duración,
alineación, intensidad, dirección y curva. Es el mismo sistema real de dos clips (se mezclan fotogramas de ambos vídeos).

* El plan se calcula entero antes de confirmar. Cada corte solo toca el final de su clip A y el inicio de su clip B, así que ningún extremo
  se recorta dos veces; nunca se baja de 1 s por clip.
* Si un corte no admite la duración sin congelar un fotograma: se usa la más larga que quepa, o se deja sin transición (a elegir). También
  se puede prohibir recortar: entonces solo se usa el material que ya hay.
* Cada transición sigue siendo editable por separado, y Ctrl+C / Ctrl+V de transiciones no cambia.

Límites: 5000 clips por montaje y 6 h (antes 4 h). Pruebas: `npm run test:repeat` (vídeo real, motor + editor + exportador del navegador),
secciones 36–38 de `scripts/browser-tests.mjs`, `tests/repeat-batch.test.ts`.
