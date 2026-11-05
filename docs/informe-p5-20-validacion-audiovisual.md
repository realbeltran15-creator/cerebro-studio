# Informe P5.20 — Validación audiovisual y automatización de sonido

Rama `beta-privada`, coste 0 €, sin push, cuentas, credenciales ni cambios en Production.

## 1. Mejoras implementadas
**Automatización de volumen dentro de un clip de vídeo.** La auditoría confirmó la carencia: el sonido propio de un clip de vídeo solo tenía un volumen fijo (y, desde P5.19, entrada/salida gradual). Ahora admite **varios puntos** (tiempo desde el inicio del clip, nivel 0–200 %) unidos en línea recta, combinados con los fundidos.
- **Reutiliza el sistema de los clips de audio**, no lo duplica: misma función `envelopeAt`, mismo editor «Puntos de volumen» (se adaptó `AutomationEditor`), mismo validador (`parseEnvelopePoints`, ahora compartido también por el audio) y mismo botón «Añadir punto en el cabezal».
- Visor y exportación usan la misma regla (`clipSoundFade` / `videoVoices`); una prueba unitaria compara ambos en 8 instantes.
- Validación: se descartan puntos no numéricos o con tiempo negativo, el nivel se limita a 0–2, se ordenan y se aceptan hasta 64.
- **Dividir** conserva el nivel exacto en el corte (cada mitad recibe un punto en el corte) y reparte los fundidos (la primera mitad conserva la entrada, la segunda la salida); **recortar el inicio** desplaza los puntos.
- Interfaz: sección «Automatización y fundidos del sonido» en el inspector del clip de vídeo.

## 2. Plantilla vertical 9:16 de extremo a extremo (E2E M40, desde la interfaz)
Guardar el montaje vertical como plantilla → rellenar sus huecos con **otros** archivos (vídeo `clip-a.mp4`, imagen `still.png` y música `tono`) → crear el montaje → exportar a MP4 480p → medir. Resultado:
- Resolución 480×854 (9:16), h264 + aac; duración 11,03 s frente a 11,00 s esperados.
- **Los materiales sustituidos aparecen realmente:** color medio del vídeo nuevo esperado [122,127,127] frente a [136,120,120] en el MP4 (Δ 17); imagen nueva [192,62,31] frente a [191,61,29] (Δ 2); ninguno se parece al azul/verde de la plantilla original.
- La música y los subtítulos se conservan (1 clip de audio como en la original; 2 subtítulos en el primer clip).
- Duración: se mantuvieron 6,0 s + 5,0 s; el ajuste automático por archivo más corto está cubierto por pruebas unitarias (`montage-template.test.ts`), no por este E2E.

## 3. Calidad de exportación (MP4 de la plantilla)
- Bitrate ≈ 540–600 kb/s a 480×854.
- **Fotogramas 264 frente a 265 esperados a 24 fps** (diferencia de 1; no hay pérdidas).
- Sincronía audio/vídeo: inicio 0,000 s de diferencia; duración de audio y de vídeo difieren 0,029 s.
- «Congelados»: 1 tramo, que es la **imagen fija** de 5 s (esperado, no un defecto); `mpdecimate` descarta ≈150 fotogramas por el mismo motivo.
- SSIM 0,999 entre un fotograma de la imagen y su original escalado: **solo informativo**, válido porque existe una referencia directa (imagen fuente recortada al formato); no se usa PSNR como indicador absoluto y no hay referencia para el vídeo.
- Automatización de volumen (MP4 de 6,04 s, entrada 1 s + puntos 0 s·100 % / 2 s·100 % / 6 s·10 %): RMS 0 s −49,9 dB; 1,3 s −24,3 dB (pleno); 4 s −28,9 dB (−4,6 dB, esperado −5,2); 5,7 s −38,7 dB (−14,5 dB, esperado ≈ −16). Coherente con la interpolación.

## 4. Rendimiento (relevante para un PC de 3,6 GB)
- Exportar el montaje vertical de 11 s a 480p: **5,5 s**.
- Heap JS de la página: ≈ 32–39 MB.
- **Memoria total de un navegador nuevo con una sola página durante la exportación: pico ≈ 1,9 GB** (todos sus procesos; Chromium sin GPU del entorno de pruebas; el valor de un Chrome con GPU en Windows puede ser distinto).
- Riesgo: en el PC de Jesús (3,6 GB totales, 0,4 GB libres) una exportación podría agotar la memoria. No se ha medido allí. Mitigaciones sin añadir dependencias: cerrar el resto de programas y pestañas, exportar a 480p y, si falla, partir el montaje. Recomiendo que Jesús haga una exportación corta y observe el Administrador de tareas **solo con su autorización**.
- No se añadieron dependencias.

## 5. Regresión (completa, hoy)
- TypeScript: 0 errores. ESLint: 0 errores (143 avisos, 2 nuevos por tests).
- Vitest: **1678 correctas**, 22 omitidas (7 pruebas del sonido de clip).
- Propuestas de seguridad en stack oficial: 18/18.
- E2E de módulos con stack oficial: **45/45** (incluye M39 automatización y M40 plantilla vertical).
- Chromium completo: «All browser checks passed».
- Exportación en tiempo real sigue desactivada.

## 6. Limitaciones y bloqueos
- Memoria de exportación sin medir en el PC real (sin autorización ni instalación).
- Calidad de vídeo solo con métricas internas y de referencia directa en imágenes; el vídeo no tiene referencia comparable.
- Clips con velocidad distinta de 1: la exportación rápida ya los rechaza y usa otra ruta (sin cambios aquí).
- Alojamiento remoto, conexiones YouTube/Instagram, transcripción real y migraciones remotas siguen pendientes de autorización o credenciales.

## 7. Recomendación de siguiente fase
Consolidar: preparar la beta accesible desde el navegador solo cuando Jesús autorice crear un proyecto Supabase y uno Vercel independientes y se confirme la capacidad gratuita real; mientras tanto, abstenerse de nuevas funciones y medir la memoria de exportación en su PC con su permiso.
