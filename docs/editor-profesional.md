# Editor profesional: guardado, transiciones, animaciones y coherencia visor/exportación

Estado: octubre de 2026. Rama `fase1-seguridad`, Preview privada. Sin migraciones de base de datos.

## 1. Guardado

| Qué | Dónde | Para qué |
|---|---|---|
| El montaje completo | `render_jobs.composition` (jsonb, servidor) | La copia que cuenta: se abre igual en cualquier navegador o dispositivo con la misma cuenta. |
| Puntos de recuperación | Almacenamiento privado del propietario: `<usuario>/<proyecto>/versions/<montaje>/*.json` | Volver a una versión anterior. Se guardan los 30 últimos. |
| Preferencias, estilos, transiciones y animaciones favoritas | `connector_configs` (servidor) | Reutilizarlos en todos los montajes. |
| Copia de seguridad local | IndexedDB del navegador | Solo para recuperarse de un cierre inesperado; se ofrece, nunca se aplica sola. |
| Historial de deshacer | IndexedDB del navegador | Ctrl+Z sigue funcionando después de recargar en el mismo navegador. |

**Cuándo se guarda**

- Guardado automático 2,5 s después de cada cambio, nunca a mitad de un arrastre.
- Los guardados van uno detrás de otro. Si cambias algo mientras se está guardando, ese cambio queda pendiente y se guarda después; no se marca como guardado.
- «Guardar ahora» guarda en el momento y crea un punto de recuperación.

**Estado visible**

- «Cambios sin guardar».
- «Guardando…».
- «Guardado en la nube · hora».
- «Error al guardar»: se reintenta solo a los 5, 15, 30 y 60 s.
- «Conflicto».

**Conflictos.** Si el montaje se guardó desde otra pestaña o dispositivo, no se sobrescribe. Puedes elegir entre:

- cargar la versión más reciente;
- guardar la tuya encima;
- guardarla como copia.

En los tres casos tu versión queda antes como punto de recuperación.

**Al cerrar la página** con cambios sin guardar, el navegador pide confirmación.

**Todo lo que se guarda.** Una prueba unitaria (`tests/editor-persistence.test.ts`) guarda un montaje con todas las propiedades y comprueba que vuelve idéntico de la base de datos. Las propiedades son:

- clips, recortes, velocidad y volumen;
- transiciones con su duración, dirección, intensidad y curva;
- filtros, recorte de imagen, rotación, opacidad y fotogramas clave;
- movimientos de cámara;
- superposiciones;
- pistas: nombre, bloqueo, oculta, silencio y solo;
- marcadores;
- textos con todos sus estilos;
- subtítulos;
- audio: panorámica, automatización y fundidos;
- mezcla;
- formato;
- exportación.

## 2. Transiciones

- **Tipos:**
  - corte;
  - fundido a negro (también desde negro);
  - fundido a blanco;
  - disolvencia;
  - deslizar y cortinilla, en 4 direcciones;
  - zoom de entrada y de salida;
  - desenfoque;
  - destello de luz.
- **Ajustes:** duración por corte, dirección, intensidad (zoom, desenfoque, destello) y curva (suave, lineal, acelera, frena).
- **Cómo aplicarlas:**
  - arrastrándolas entre dos clips desde la pestaña «Transiciones»;
  - con clic sobre el clip seleccionado;
  - copiar y pegar;
  - quitar;
  - aplicar a los cortes seleccionados o a todos;
  - favoritas guardadas en la cuenta.
- **Durante una transición se ven los dos clips.**
  - Si el vídeo entrante tiene material antes de su inicio (está recortado), se reproduce durante la transición.
  - Si no lo tiene, mantiene su primer fotograma hasta que le toca. Así nunca cambia su propio tiempo.
  - El sonido de los dos vídeos se funde igual que la imagen.

## 3. Animaciones

- **Fotogramas clave** en superposiciones (posición, tamaño, giro, opacidad) y en los clips principales (zoom, encuadre, giro, opacidad).
  - Cada fotograma tiene su propia curva: suave, lineal, acelera, frena o salto.
  - Se editan en tabla (tiempo, valores, curva) o arrastrando en el visor; el visor fija el fotograma clave del cabezal.
- **Copiar y pegar animación.**
- **Movimientos listos para fotos lo-fi:** respiración lenta, acercar y alejar, deriva lateral, subida, giro leve.
- **Animaciones propias** guardadas en la cuenta.
- **Al dividir un clip** la animación continúa sin saltos.
- **Límite honesto:** son efectos de edición sobre la imagen entera. Animar solo una parte de una foto (la luz de unas velas, el agua…) requiere separarla en su propia capa o generar vídeo con IA, que no está activado. Las instrucciones lo dicen así.

## 4. Visor y exportación

El visor y los dos exportadores usan la misma descripción de cada fotograma (`lib/editor/scene.ts`), el mismo dibujo (`lib/editor/draw.ts`) y los mismos niveles de sonido.

| Comprobado | Prueba |
|---|---|
| Capas, vídeo principal y superpuesto, fotos, títulos | Navegador 24 y 25: colores en los mismos instantes y puntos |
| Mitad de una disolvencia, una cortinilla y un deslizamiento | Navegador 24, 26 y 27 |
| Dos músicas, voz, efecto, sonido de los dos vídeos, bajada de música bajo la voz, punto de automatización | Navegador 24, analizando cada tono del archivo exportado |
| Duración y tamaño | Navegador 24 y 25 |

**Diferencias que existen**

- **Exportación en tiempo real** (grabación): el reloj depende del navegador, así que a mitad de una transición puede haber un desfase de uno o dos fotogramas. La exportación rápida es exacta fotograma a fotograma y es la predeterminada.
- **Filtros en Safari:** el lienzo de Safari no aplica filtros (brillo, contraste, saturación, desenfoque). Se ven y se exportan en Chrome y Edge, y el editor lo avisa.
- **Vídeos con sonido a otra velocidad:** se exportan en tiempo real para conservar el tono del audio.

## 5. Pruebas

**Unitarias:** ida y vuelta de todas las propiedades, pistas, transiciones, curvas, fotogramas clave e instrucciones.

**Navegador:**

| Prueba | Qué cubre |
|---|---|
| 22 | Reproductor con 90 min |
| 23 | Multipista y visor |
| 24 | Verificación integral, motor de exportación |
| 25 | Verificación en el editor real |
| 26 | Persistencia: guardado automático, recargar, sesión limpia en otro navegador, conflicto, puntos de recuperación, exportar tras cambiar una transición |
| 27 | Transiciones, favoritas, animaciones, sesión limpia y exportación igual al visor |
| 28 | Espacio de trabajo: barra lateral, grupos, propiedades, paneles, pestañas, modos, búsqueda, escritorio, tableta y móvil |

Ninguna prueba usa ni modifica el proyecto «Lofi prueba».

## 6. Espacio de trabajo

**Barra lateral** (todas las páginas), tres comportamientos: **Fija** (siempre abierta), **Automática** (una franja de iconos de 60 px; al acercar el ratón o pulsar el botón de arriba se abre por encima de la página, sin mover el visor ni la línea de tiempo, y se cierra sola medio segundo después de salir; no se cierra mientras el teclado está dentro; en pantallas táctiles el primer toque solo la abre y un toque fuera la cierra) y **Oculta** (sin columna; queda un botón pequeño en el borde izquierdo). La chincheta la fija o la desfija; Escape la cierra; cada icono tiene su nombre como información emergente. La elección se recuerda en el navegador. En el móvil sigue siendo el menú desplegable.

**Editor manual**

| Zona | Qué contiene |
|---|---|
| Barra superior | Estado del guardado, guardado automático, puntos de recuperación, formato, espacio de trabajo, mostrar u ocultar «Herramientas» y «Propiedades», búsqueda de herramientas, cortar, marcar, añadir texto, deshacer, rehacer y guardar. Debajo, una línea para dar instrucciones. |
| Izquierda: pestañas | Materiales (lista e importación), Transiciones (para arrastrar o aplicar), Efectos (filtros, movimientos y cámara para todo lo seleccionado), Textos (lista, subtítulos SRT/VTT), Audio (mezclador, ritmo y pulsos), IA (preferencias, historial de instrucciones, estilos, plantillas, referencia, comparar, aprender). |
| Centro | Visor con altura ajustable y el grupo «Exportación». |
| Derecha: propiedades | Cambian con la selección: foto, vídeo (además inicio, velocidad, volumen), capa superpuesta, audio (sonido, automatización), texto (texto, estilo) y, sin selección, el proyecto (formato, transiciones, gancho, música, subtítulos). Grupos desplegables: los esenciales abiertos, los avanzados cerrados salvo que ya tengan valores. |
| Abajo | Línea de tiempo multipista a todo el ancho. |

- Los paneles laterales se redimensionan arrastrando o con las flechas en sus separadores; se ocultan y vuelven sin perder la pestaña ni lo escrito.
- Modos: Edición, Audio (mezclador y pistas más altas), Efectos (pestaña Efectos y propiedades más anchas) y Pantalla amplia (oculta paneles y barra lateral; al salir vuelve la barra como estaba).
- «Buscar herramienta» (Ctrl+K): transición, volumen, recortar, subtítulos, zoom, exportar, filtros, animación, música, formato, marcadores… abre la pestaña o el grupo que corresponde a lo seleccionado y lo resalta.
- El diseño (tamaños, pestaña, grupos abiertos, modo) se guarda en este navegador (`cerebro-editor-layout`); no forma parte del montaje.
- Tableta y móvil: una columna con el visor primero; los separadores se ocultan; las pestañas se desplazan en horizontal.

Prueba de navegador 28: barra lateral en sus tres modos y el ancho liberado, grupos, propiedades según la selección, pestañas, efectos, redimensionar, ocultar y restaurar, modos, búsqueda, diseño recordado tras recargar, guardado, reproducción y línea de tiempo, en 1500, 820 y 390 px con la hoja de estilos real.
