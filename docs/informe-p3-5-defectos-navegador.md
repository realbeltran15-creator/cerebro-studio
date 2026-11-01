# P3.5 — Defectos detectados en Chromium real

Entorno: Chromium del sandbox + Supabase SIMULADO en memoria (`npm run test:browser`, con CHROMIUM_PATH). No es una prueba con sesión, base de datos ni almacenamiento reales.

| # | Síntoma | Diagnóstico | Resultado |
|---|---|---|---|
| 1 | Exportación ≠ vista previa («verify realtime») | NO reproducido: 3/3 ejecuciones aisladas, 1 con CPU saturada y varias pasadas completas pasan en los modos rápido y tiempo real. Falló una vez dentro de una pasada completa. Hipótesis (no demostrada): el modo en tiempo real depende de la velocidad de la máquina. | **Sin causa demostrada.** Seguir vigilando; no se cambió ninguna expectativa. |
| 2 | Control «Velocidad» no visible | Existe y es visible. El selector de la prueba era ambiguo («Rampa de velocidad» también coincidía). | Prueba corregida. Nuevo test con FFmpeg real (`tests/e2e-velocidad.test.ts`): velocidad 2 recorre rojo→azul en 2 s, 0.5 solo rojo, original intacto. La persistencia al guardar/reabrir ya la cubren `editor-persistence.test.ts`. |
| 3 | Arrastrar la esquina del visor no agranda la capa | **Defecto real.** El navegador iniciaba un arrastre nativo (`dragstart`) al pulsar el tirador, cancelaba el puntero (`pointercancel`) y el tamaño se quedaba en +2 %. | Corregido en `viewer-handles.tsx` (sin selección ni arrastre nativo en el visor). Medido: 40 % → 49 % → 58 % → 76 % con el mismo arrastre. Sin prueba táctil. |
| 4 | VP9/WebM no marcado para Instagram | Este Chromium graba MP4/H.264, que SÍ es compatible: la aplicación acierta. La prueba suponía WebM. Forzar WebM en este entorno hace la exportación demasiado lenta para probarla. | Prueba reescrita: comprueba el formato realmente guardado (MP4/H.264 → sin aviso; WebM → aviso y botón de conversión). La rama WebM solo está cubierta por test unitario (`instagramReadiness`), NO por navegador. La conversión local a MP4 no se ha ejecutado. |

Otros hallazgos al reparar el arnés: Shorts mostraba el aviso/error dos veces (corregido); el simulador no tenía `like()` (Analytics); faltaban 2 variables de entorno en el arnés; varias pruebas esperaban cuadros nativos que ahora son confirmaciones dentro de la tarjeta; los datos de relleno sin cabecera real ahora se rechazan (comprobación de formato) y las pruebas se corrigieron.

Estado de la suite: 681 comprobaciones OK en la última pasada completa; la pasada se detuvo en la copia/pega de transiciones entre cortes repetidos (`^Transición .* entre el clip N`), sin diagnosticar (puede ser de virtualización de la línea de tiempo con 200 repeticiones). Quedan sin ejecutar las comprobaciones posteriores.
