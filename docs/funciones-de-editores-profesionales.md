# Funciones tomadas de editores profesionales

Fuentes consultadas (manuales oficiales): guía de usuario de Final Cut Pro, manual de referencia de DaVinci Resolve (página Edit), ayuda de Adobe Premiere (herramientas, recorte, velocidad, efectos, audio) y centro de ayuda de CapCut. Comparadas con lo que ya tenía Cerebro Studio; se replicó lo que faltaba y se podía hacer en local, sin servicios de pago.

## Implementado

| Función | Origen | Cómo se usa | Verificado |
|---|---|---|---|
| Slip (deslizar contenido) | Premiere, DaVinci, Final Cut | Inspector del clip → «Edición de precisión» | Pruebas unitarias |
| Slide (deslizar clip entre vecinos) | idem | idem | Pruebas unitarias |
| Roll (mover el corte) | idem | idem | Pruebas unitarias |
| Cortes en J y en L | Premiere, DaVinci | idem (Corte J / Corte L) | Pruebas unitarias |
| Congelar fotograma | Premiere, Final Cut | Botón o clic derecho → «Congelar fotograma en el cabezal» | Exportación real en Chromium |
| Rampa de velocidad (lineal) | Premiere (time remapping), Final Cut | Inspector → «Rampa de velocidad» | Exportación real en Chromium |
| Modos de fusión (8) | Premiere, DaVinci, Final Cut, CapCut | Inspector → «Fusión, máscara y clave de color» | Píxeles + exportación real |
| Máscaras de forma (elipse, redondeado, rectángulo, invertir) | idem | idem | Píxeles + exportación real |
| Clave de color (chroma key) | CapCut, Premiere, DaVinci | idem | Píxeles + exportación real |
| Normalizar volumen | Premiere (loudness), Final Cut | Audio → «Normalizar volumen» | Pruebas unitarias |

## Límites honestos

- Un clip con rampa, congelado o invertido no emite su propio sonido.
- La rampa es lineal (de la velocidad del clip a la velocidad final). No hay curvas de Bézier.
- La clave de color es por distancia de color en RGB: sirve para fondos limpios, no sustituye a una clave profesional con corrección de derrame.
- Las máscaras son de forma fija; no hay máscaras libres dibujadas ni seguimiento.
- Las pruebas de exportación usaron VP9 en Chromium (el de pruebas no decodifica H.264).

## No implementado (y por qué)

- Estabilizador (Warp Stabilizer): requiere estimar el movimiento de cámara fotograma a fotograma y recolocar la imagen; no existe aún un análisis de movimiento en el editor.
- Auto Reframe con seguimiento de sujeto, edición por transcripción, mejora de voz con IA, reducción de ruido espectral, generación de vídeo con IA: dependen de modelos de IA o servicios de pago.
- Clips compuestos / anidados, multicámara, roles: cambio de modelo de datos grande; conviene diseñarlo aparte.
