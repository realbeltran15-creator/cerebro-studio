# Informe P5.13 — Accesibilidad, usabilidad y trazabilidad de subtítulos

Rama `beta-privada`, 0 €, sin push ni cambios remotos.

## Problemas detectados
- Los subtítulos no guardaban de dónde venían; un `.auto.srt` podía parecer revisado tras tocar un solo segmento.
- axe (WCAG 2 A/AA) en móvil (390 px): el botón «Nuevo proyecto» quedaba sin nombre accesible porque su texto se ocultaba con `display:none`.
- Una transcripción cuyo subtítulo cruza el límite de dos clips se divide en dos filas (comportamiento correcto, ahora cubierto por pruebas).

## Correcciones
- Campo opcional `origin` por subtítulo: `auto`, `auto-edited`, `manual`, `imported`. Se conserva al editar, guardar, recuperar, recortar y dividir clips. Proyectos antiguos cargan sin origen; un valor inválido guardado se ignora.
- Editar un automático solo cambia ese subtítulo a «corregido»; el botón «Revisado» (accesible por teclado) lo da por revisado sin cambiarlo; el panel muestra «N automáticos SIN revisar» hasta que no quede ninguno.
- Pegar texto → `manual`; SRT/VTT → `imported`; `*.auto.srt` → `auto`. El SRT exportado sigue siendo estándar.
- CSS móvil: la etiqueta pasa a «solo lectores de pantalla» en vez de desaparecer.

## Pruebas
- Vitest 1663 correctas; 7 nuevas de origen. TypeScript 0 errores; ESLint 0 errores.
- E2E de módulos 40/40: M35 comprueba origen, corrección parcial, orden de Tab (Revisado → Inicio → Fin → Texto → Quitar), persistencia tras recargar, axe en escritorio y móvil sin violaciones y sin desbordamiento horizontal.
- Chromium principal: 686/686. Recorrido completo (proyecto → importar → plantilla → editar → subtítulos → MP4 → recuperar) cubierto por M26–M35.

## Seguridad
Cambios solo de interfaz y datos de composición; validación de servidor intacta (`parseComposition` filtra el origen). La política RLS de propiedad de proyecto sigue **pendiente y sin aplicar en remoto**; no publicar la beta sin ella.

## Limitaciones
- Transcripción real sin medir (sin modelo). Auditoría de usabilidad con usuarios sintéticos, no personas.
- Solo se auditó con axe y teclado el panel de subtítulos y la pantalla inicial móvil en este paso; el resto lo cubre la suite Chromium existente.

## Siguiente fase
Evaluación de uso real: crear vídeos completos de punta a punta, listar funciones que faltan; probar el modelo whisper en el PC de Jesús bajo supervisión.
