# Informe P5.19 — Producción de vídeo y acceso privado

Rama `beta-privada`, coste 0 €, sin push, cuentas, túneles ni cambios en Production.

## 1. Revisión de carencias del editor (antes de programar)
Ya existían y **no se tocaron**: 12 transiciones con duración y opciones; volumen por clip de vídeo y silenciar; volumen, fundidos y envolvente de puntos en clips de audio; mezclador por pistas; subtítulos con origen; recorte al añadir; verticales y horizontales; plantillas de montaje (estructura reutilizable con huecos y reemplazo de archivos, `tests/montage-template.test.ts`) y plantillas de estilo (16:9, 9:16 y 1:1).

**Carencia real encontrada:** el sonido propio de un clip de vídeo solo tenía volumen y silencio; no se podía entrar ni salir gradualmente (solo fundía cuando había transición de mezcla). En un corte seco el audio arranca o se corta de golpe.

## 2. Mejora implementada: fundido de entrada y salida del sonido de cada clip de vídeo
- Modelo: `audioFadeInMs` / `audioFadeOutMs` en el clip (se validan y se guardan; entran en la huella de control de calidad).
- Visor y exportación comparten la misma regla (`clipSoundFade`): rampa lineal desde el inicio del clip y hasta su final; con transición de mezcla gana el fundido más largo.
- Interfaz: dos casillas en el inspector del clip, «Entrada gradual del sonido (s)» y «Salida gradual del sonido (s)».
- Pruebas: Vitest nuevo `tests/clip-sound-fade.test.ts` (4: rampas, guardado/validación, visor, y que la envolvente de exportación coincide con el visor en 7 instantes). E2E nuevo **M39** desde la interfaz: añade clip, fija 1,5 s + 1,5 s, guarda, recarga (persiste), exporta MP4 480p y mide el audio.

## 3. Evidencia medida (MP4 `p5-19-fundido-sonido-clip.mp4`, 6,04 s)
Nivel RMS del audio: **inicio −49,8 dB**, **centro −24,6 dB**, **final −41,7 dB**. La diferencia de ≈25 dB entre el centro y el inicio confirma la entrada gradual; el final cae ≈17 dB en la ventana de 0,25 s final (no llega a silencio absoluto porque la ventana incluye parte de la rampa). El MP4 decodifica sin errores.

## 4. Plantillas y calidad de exportación
Cubierto por pruebas anteriores que siguen pasando: plantilla con clip de vídeo + imagen en 16:9 (M32), vertical 9:16 desde cero con subtítulos visibles (M36), MP4 h264/aac decodificables, duración y sincronía subtítulos/vídeo (M34–M37). No se repitieron nuevas medidas de calidad de codificación (bitrate, artefactos) en esta fase. Una plantilla de montaje en 9:16 con sustitución de archivos no tiene prueba E2E propia (solo unitaria). La exportación en tiempo real sigue desactivada.

## 5. Acceso remoto privado (solo investigación)
Hechos del entorno: PC de Jesús con 3,6 GB de RAM y 7,3 GB de disco (P5.18). Org de Supabase en plan **free** con 3 proyectos (Cerebro Studio activo, Cazador de Cupones activo, gamemur inactivo): si se puede crear otro proyecto gratuito no está comprobado. Las páginas de precios de Supabase/Vercel/Tailscale/Cloudflare **no pudieron leerse en esta fase** (solicitud de permiso sin respuesta), así que sus cifras actuales **no están verificadas**.

| Alternativa | Seguridad | Persistencia / disponibilidad | Hardware de Jesús | Coste |
|---|---|---|---|---|
| **A. Backend y app en nubes gratuitas separadas** (nuevo proyecto Supabase *Free* + proyecto Vercel nuevo con solo 3 variables; plan ya escrito en `docs/beta-privada-publicacion.md`) | Aislado de Production; `check-beta-config` rechaza claves de Production | Siempre disponible; límites de almacenamiento (unos 50 MB por archivo y ~1 GB según los informes previos) y posible pausa por inactividad: por verificar | Solo un navegador; **la exportación se hace en su navegador** (memoria: la suite de navegador mide ~137 MB de JS con 3000 clips) | 0 € si se confirma que no pide tarjeta; crear cuentas/proyectos exige su autorización |
| B. Servidor en un entorno de Claude | — | **Descartada:** el contenedor se recicla; no es servidor permanente | — | — |
| C. VM gratuita autoalojada (Oracle) | Hay que administrar TLS y secretos | Reclamación por inactividad, sin SLA | Ninguno | Exige tarjeta (P5.17) |
| D. Otro ordenador propio con túnel privado (Tailscale/Cloudflare) | Buena si solo hay acceso privado | Depende de que ese equipo esté encendido | Necesita ≥ 8 GB RAM y disco | Cifras no verificadas |
| E. Local en su PC | Máxima | Solo con el PC encendido | **No viable** (3,6 GB RAM, 7,3 GB disco) | 0 € |

**Recomendación técnica:** A. Es la única que no exige hardware nuevo ni tarjeta (por confirmar) y mantiene Production aislada. Antes de usarla Jesús debería (1) liberar disco y cerrar programas para exportar, (2) autorizar crear el proyecto Supabase y el proyecto Vercel nuevos, (3) autorizar aplicar `schema-beta.sql` (incluye propiedad de proyectos y permisos mínimos) **solo en ese proyecto nuevo**, nunca en Production.

## 6. Validación
tsc 0 errores · ESLint 0 errores (141 avisos previos) · Vitest 1675 correctas (tests nuevos: 4) · E2E de módulos 44/44 en el stack oficial · propuestas de seguridad 18/18 (hoy) · Chromium completo «All browser checks passed» (hoy, antes del cambio de la interfaz del inspector; no repetido tras P5.19).

## 7. Pendiente
Calidad de codificación sin medir más allá de P5.14–P5.18; plantilla 9:16 sin E2E; cifras de planes gratuitos sin verificar; transcripción automática sin modelo; YouTube/Instagram sin credenciales.
