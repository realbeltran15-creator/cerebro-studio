# Informe P5.14 — Evaluación práctica con tres vídeos

Rama `beta-privada`, 0 €, datos sintéticos, sin push ni cambios remotos. Los recorridos son **pruebas automatizadas por la interfaz real** (sin tocar la BD ni saltarse pasos de la aplicación); NO son una evaluación con personas. Los tiempos son medidos por el cronómetro de la prueba en un entorno de 2 CPU, no estimaciones.

## Resultados individuales
| Vídeo | Prueba | Tiempo medido | Resultado |
|---|---|---|---|
| 1. Plantilla con imágenes + música | M26 | 67,5 s | MP4 h264 + aac verificado (FFprobe + decodificación), fotogramas con el material importado, recuperado tras cerrar sesión (M27) |
| 2. Clip importado recortado + imagen | M31 | 52,4 s | MP4 con vídeo y audio; el clip aparece (azul dominante) y la imagen (verde); recorte y división guardados |
| 3. Vertical 9:16 con subtítulos | M36 | 23 s (render 4 s), 24 acciones | MP4 480×854 h264 + aac, 11 s; subtítulos visibles |

Vídeo 3: creado desde cero (formato 9:16), clip + imagen + música añadidos desde el panel de Materiales, SRT importado, primer subtítulo editado, exportado. Texto blanco en la franja inferior a 1,5 s (1303 px) y 4,0 s (2359 px), 0 entre subtítulos (2,75 s) y 0 en la zona superior: sincronizados y dentro del encuadre.

## Problemas encontrados y corregidos
- Sin defectos de producto que impidieran los recorridos. Errores de la propia prueba (selectores, elegir el clip equivocado de la Biblioteca, que contiene también MP4 exportados) corregidos en el guion.
- Hallazgo de usabilidad: la Biblioteca mezcla clips importados y MP4 exportados en el mismo desplegable «[video]»; fácil elegir el equivocado (ver mejora 2).

## Funciones y puntos de fricción
- Para añadir material hay que saber que está en la pestaña «Materiales» > «Importar o añadir» (plegado); el vídeo se mide con su duración real (10 s) y no se puede elegir el tramo al añadirlo.
- La vista previa de subtítulos en el visor no se verificó por interfaz en esta ronda (solo en el MP4 exportado).
- Acciones técnicas: ninguna exigió consola o scripts, pero la transcripción automática sigue siendo solo línea de comandos.

## Evidencia técnica
FFprobe y decodificación completa (`ffmpeg -f null`) de los MP4 en M26, M31, M34 y M36. Exportación en tiempo real desactivada. Código de la aplicación sin cambios en P5.14; solo pruebas y cronómetro por paso. TypeScript 0 errores, ESLint 0 errores, E2E 41/41. Vitest 1663 y Chromium 686/686 de P5.13 (la aplicación no cambió).

## Diagnóstico: LISTO CON LIMITACIONES para uso local
Se producen vídeos completos de punta a punta (plantilla, clip importado, vertical con subtítulos) sin intervención técnica. Faltan: transcripción automática real (modelo sin probar), alojamiento aislado y aplicar la política RLS antes de cualquier uso fuera del equipo, y material gratuito real (Pexels/YouTube sin claves).

## Cinco mejoras de mayor impacto
1. Medir y activar la transcripción whisper.cpp con un modelo real, con un botón en la app local.
2. Separar en la Biblioteca los MP4 exportados de los clips importados (y mostrar miniatura al elegir).
3. Elegir el tramo del clip al añadirlo (entrada/salida) y previsualizar el subtítulo en el visor.
4. Atajo «Importar y añadir al montaje» visible sin desplegar paneles.
5. Aplicar la política RLS de propiedad de proyecto y montar el alojamiento aislado (requiere autorización de Jesús).
