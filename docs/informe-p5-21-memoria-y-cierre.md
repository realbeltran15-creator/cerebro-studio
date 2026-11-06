# Informe P5.21 — Memoria de la exportación y cierre técnico de la beta

Rama `beta-privada`, coste 0 €, sin push, sin cuentas ni proyectos externos, sin tocar Production, sin pruebas en el PC de Jesús.

## 1. Diagnóstico (medido)

Método: Chromium nuevo por repetición, una sola página, memoria **PSS** (`/proc/<pid>/smaps_rollup`) clasificada por tipo de proceso. La suma de RSS sobreestima ≈1,8× (bibliotecas compartidas) y no se usa para decidir. Escenario: plantilla 9:16 de 480×854, ≈11 s, vídeo 1280×720 H.264 + imagen + música + subtítulos (E2E M41, 3 repeticiones + 3 exportaciones seguidas en la misma página).

**Antes:** pico total mediana ≈1011–1027 MB; renderizadores ≈812–829 MB (inactivo ≈210); navegador 73, GPU 43, utilidades 62, otros 21. Heap JS de la página solo ≈21 MB → el crecimiento era memoria **nativa**.

**Atribución** (mismo montaje quitando una parte cada vez; aumento del renderizador sobre el inactivo):

| Variante | Antes (MB) |
|---|---|
| completo | +693 |
| sin audio | +605 |
| sin subtítulos | +675 |
| sin vídeo (solo imágenes + música) | +73 |
| solo imágenes y sin audio (codificación + lienzo) | +72 |

Conclusión: el audio aporta ≈90 MB, imágenes y codificación ≈70 MB, subtítulos ≈0. **≈600 MB eran del vídeo de origen**, no del Editor.

**Causa aislada** (micro-prueba solo de decodificación, 360 fotogramas 720p): decodificar muestras y cerrarlas cuesta +19 MB; dibujar cada `VideoFrame` en un canvas (lo que hace `CanvasSink`) cuesta +500…690 MB, también si se dibuja directo a un canvas persistente o vía `createImageBitmap`. Chromium conserva imágenes convertidas por fotograma hasta que actúa el recolector. Reutilizar canvases (anillo de 4) no lo arregla (−10 %). Copiar el fotograma con `VideoFrame.copyTo(RGBA)` + `putImageData` en un canvas reutilizado: **+55 MB y 1,7× más rápido**.

No hay fuga: tres exportaciones seguidas en la misma página se estabilizan (picos 342–364 MB de renderizador tras el cambio; 836–877 antes).

## 2. Cambios

- Nuevo `lib/editor/rgba-canvas-sink.ts`: fuente de fotogramas con `VideoSampleSink` + `copyTo(RGBA)` + `putImageData`; anillo de canvases reutilizados en el lector secuencial, un canvas por fotograma en el lector inverso (que guarda ventanas).
- `lib/editor/fast-export.ts`: `makeSink` usa la ruta nueva salvo pista rotada o navegador sin `VideoFrame.copyTo`, donde conserva `CanvasSink` (con anillo de 4 canvases).
- E2E: M41 (memoria por tipo de proceso, 3+3 exportaciones), atribución por componentes y serie temporal.
- Sin dependencias nuevas; la exportación en tiempo real sigue desactivada.

## 3. Comparación antes / después (misma escena, resolución y navegador)

| Medida | Antes | Después |
|---|---|---|
| Pico total (PSS, mediana de 3) | ≈1011–1027 MB | **557 MB** (545/557/573) |
| Pico renderizadores | ≈812–829 MB | **359 MB** |
| Aumento sobre el inactivo (completo) | +693 MB | **+180 MB** |
| Tras exportar (total) | 900–1105 MB | **453–456 MB** |
| Suma RSS (sobreestima) | ≈1800 MB | ≈1360 MB |
| Tiempo de exportación (M41) | 5,5–6,1 s | **2,8–3,2 s** |
| Tiempo en M40 | 4,6 s | 3,2 s |
| MP4 | 480×854, 11,03 s (esp. 11,00), 264/265 fotogramas, A/V Δ 0,029 s, bitrate ≈540–600 kb/s | 480×854, 11,03 s, 264/265, A/V Δ 0,029 s, 597 kb/s |
| Color (Δ vídeo / imagen) | 17 / 2 | 17 / 2 |
| Tramos congelados | 1 (imagen fija esperada) | 1 (igual) |

Real: todo lo anterior son mediciones en este entorno. Estimado: nada.

## 4. Validación

TypeScript 0 errores · ESLint 0 errores (142 avisos previos) · Vitest 1678 correctas / 22 omitidas · E2E de módulos en stack oficial 46/46 (incluye M40 y M41) · propuestas SQL 18/18 · suite Chromium «All browser checks passed».

## 5. Límites y riesgos pendientes

- El Chromium de pruebas no tiene GPU ni AAC nativo (usa el AAC WASM, ≈+50 MB). Chrome real en Windows tendrá decodificación por hardware y AAC nativo: las cifras son un **proxy**, probablemente conservador. **No se ha medido en el PC de Jesús** (3,6 GB de RAM, 0,4 GB libres): no autorizado.
- Con un total ≈560 MB de pico en la escena de prueba, un montaje largo, de mayor resolución o con varias capas de vídeo consumirá más; el lector inverso conserva su presupuesto de 160 MB por capa.
- La copia RGBA usa CPU; en la escena de prueba fue más rápida, no medida con fuentes 4K.
- El navegador con 0,4 GB libres seguirá siendo el límite: hay que cerrar programas antes de exportar.

## 6. Estado de la beta

Técnicamente lista para una beta privada alojada: seguridad A/B verificada, exportación MP4 validada en calidad y sincronía, memoria reducida a ≈la mitad. No es accesible desde el navegador de Jesús todavía porque falta infraestructura (no viable en local en su PC, ver informe P5.18).

## 7. Acciones que requieren autorización de Jesús (nada hecho)

1. Crear un proyecto Supabase gratuito nuevo (confirmar cuota en su panel: plan gratuito con 3 proyectos, uno inactivo) y aplicar allí `supabase/beta/schema-beta.sql` (incluye las dos propuestas de seguridad).
2. Crear el proyecto Vercel `cerebro-studio-beta` desde la rama `beta-privada` con solo tres variables (`.env.beta.example`); push solo de `beta-privada`; nunca `fase1-seguridad`.
3. Lista cerrada de testers y ejecutar `predeploy:check` / `check-beta-config` antes de publicar; sin Production ni claves de pago.
4. Liberar disco (7,3 GB libres) y RAM en su PC antes de exportar.
5. Opcional: permiso para medir la exportación en su PC (solo lectura de memoria, sin instalar nada).
6. Credenciales Google/Meta y aplicar las dos migraciones en remoto siguen pendientes de su decisión.
