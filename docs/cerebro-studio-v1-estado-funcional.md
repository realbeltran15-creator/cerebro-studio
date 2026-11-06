# Cerebro Studio V1 — Estado funcional (P5.24)

Rama `beta-privada`, solo local. Sin push, sin despliegues, sin cuentas ni proyectos externos, sin gasto, sin tocar Production, sin credenciales reales, sin publicar. Jesús **no** ha probado esta versión: todo lo que sigue procede de pruebas automáticas en el stack local oficial de Supabase y de un rastreo de 41 páginas en escritorio (1500×1000) y móvil (390×844).

## 1. Resumen

| Clasificación | Módulos |
|---|---|
| COMPLETO (P0) | Proyectos, Biblioteca, Guiones→Storyboard, Editor manual (importar, recortar/dividir, transiciones, volumen, vista previa, subtítulos, exportar MP4), Editar con mi estilo, Plantillas de montaje (16:9 y 9:16), Montaje automático, Shorts/Reels desde vídeo largo (`/repurpose`) con la parte de transcripción en modo sintético/pegado |
| COMPLETO (P1, local y gratuito) | Miniaturas (texto sobre imagen propia), Banco de materiales, Música y sonidos (biblioteca), Flujos de producción, Calendario editorial (recordatorio, no publica), Campañas (brief, estrategia, presupuesto, informe, datos ficticios), Costes (cálculo sobre generaciones registradas), Almacenamiento |
| PARCIAL | Transcripción automática (necesita proveedor), Investigación/Radar/Oportunidades (necesitan fuentes y claves), Analytics |
| BLOQUEADO EXTERNAMENTE | Generación de imagen/vídeo/voz con IA, YouTube, Instagram/Redes, Conectores, Influencer, Automatizaciones, Cola real de trabajos |
| DEFECTUOSO (menor) | Ver §4 |

Criterio de COMPLETO: se inicia desde la interfaz, hace su operación principal, el resultado es verificable (MP4 medido con FFprobe, filas en base de datos), guarda y recupera estado (cerrar sesión y volver), gestiona errores, respeta el aislamiento entre usuarios y pasa una prueba reproducible. No se usan porcentajes.

## 2. Inventario por módulo (E2E = pasos M1–M41 de `scripts/local-e2e-modules.mjs`)

| Módulo | Prioridad | Qué promete | Qué hace de verdad | Estado | Dependencias externas | Prueba de aceptación |
|---|---|---|---|---|---|---|
| `/projects` | P0 | Crear y abrir proyectos | Crea, lista, aísla por usuario | COMPLETO | Supabase | E2E 2, 15, 27, 28 |
| `/library` | P0 | Subir y gestionar vídeo/imagen/audio | Sube a almacenamiento privado, URL firmadas, oculta exportados por defecto, recorta al añadir | COMPLETO | Supabase Storage | E2E 5, 29, 37 |
| `/scripts`, `/create` | P0 | Guion → storyboard | Versiones de guion, escenas | COMPLETO (la generación con IA es opcional y externa) | Ninguna para texto manual | E2E 3, 4 |
| `/editor/manual` | P0 | Edición completa y MP4 | Línea de tiempo, recortar/dividir, transiciones, volumen con fundidos/automatización, subtítulos SRT (estimados/importados/editados), exportación MP4 en el navegador | COMPLETO | Navegador con WebCodecs; memoria libre | E2E 3, 31–36, 39 |
| `/editor/style` | P0 | Montar con mi estilo | Elige 3 materiales y monta; borrador persiste | COMPLETO | — | E2E M1–M4 |
| `/editor/templates` | P0 | Plantillas reutilizables | Guardar, rellenar con otros archivos, avisar de huecos, borrar; 9:16 incluido | COMPLETO | — | E2E M5–M9, M40 |
| `/editor/auto` | P0 | Análisis de silencios y cambios de plano | Detecta y recorta | COMPLETO | — | E2E M10–M11 |
| `/repurpose` | P0 | Shorts/Reels de un vídeo largo, 9:16 | Versión vertical con reencuadre elegido, subtítulos y exportación independiente; desde vídeo largo con transcripción sintética genera momentos y borradores | COMPLETO salvo transcripción automática | Proveedor de transcripción (bloqueado en beta) | E2E M12–M14, M36 |
| `/thumbnails` | P1 | Miniaturas | Texto sobre imagen propia, local | COMPLETO | — | E2E M24 |
| `/add` (banco de materiales) | P1 | Buscar e importar | Búsqueda sobre datos de prueba; importar sin duplicados con concurrencia | COMPLETO con datos de prueba; fuentes reales requieren claves | Claves de proveedores | E2E M25, M29, M30 |
| `/audio` | P1 | Música y sonidos | Biblioteca y uso en el editor; «Generar con IA» externo | PARCIAL (generar = bloqueado) | Proveedor de audio | E2E M26 |
| `/workflows` | P1 | Estado de producción | Estado calculado, visto bueno persistente, errores con reintento | COMPLETO | — | E2E M16–M18 |
| `/calendar` | P1 | Calendario editorial | Borradores con fecha prevista; no publica | COMPLETO (sin publicación) | — | E2E M19–M20 |
| `/campaigns` | P1 | Brief, estrategia, presupuesto, informe | Datos ficticios; persiste, duplica, elimina | COMPLETO (sin APIs de anuncios) | — | E2E M22–M23 |
| `/usage` | P1 | Costes | Cálculo con generaciones registradas | COMPLETO | — | E2E M21 |
| `/storage` | P1 | Uso de almacenamiento | Muestra y calcula uso | COMPLETO | Supabase | E2E M33 |
| `/market-intelligence`, `/radar`, `/opportunities`, `/analytics` | P1/P2 | Investigación, tendencias, analítica | Interfaz carga; sin fuentes/claves no produce datos reales | PARCIAL | APIs externas | Rastreo A1 |
| `/images`, `/videos`, `/voices`, `/studio`, `/studio/recreate` | P2 | Generación con IA | Interfaz y estimación de costes; generar requiere proveedor de pago | BLOQUEADO EXTERNAMENTE | OpenAI/FAL/Gemini/voces (0 € → no activados) | Rastreo A1 |
| `/youtube`, `/social`, `/connectors`, `/influencer`, `/automations`, `/queue` | P2 | Publicación y conexiones | Conectar muestra aviso claro si faltan credenciales (M38); la cola es solo lectura/simulación; nada se publica | BLOQUEADO EXTERNAMENTE | OAuth Google/Meta | E2E M38 |
| `/legal/*` | P0 | Privacidad, términos, borrado de datos | Páginas estáticas | COMPLETO | — | Rastreo A1 |

## 3. Alcance de la beta privada V1

Páginas abiertas: `/projects /scripts /create /library /audio /storage /editor/manual /editor/templates /editor/auto /editor/style /editor/styles /repurpose /thumbnails /workflows /calendar /usage /legal`. Solo 4 rutas API abiertas (URL firmada de materiales, uso de almacenamiento, URL de subida, estado de proveedores). Todo lo demás redirige al inicio o responde cerrado. Los módulos con proveedor externo no se abren, por tanto no pueden gastar ni conectar. Prueba beta (E2E_BETA, paso A4): los módulos nuevos cargan, «Transcribir» muestra «Esta función está desactivada en la beta…» y Miniaturas degrada sin romper.

## 4. Defectos y límites

Corregidos en P5.24: `/repurpose` hacía una petición con 400 al abrir un montaje manual (id `manual-<uuid>` no es UUID de storyboard) → guardia añadida.

Abiertos (registro):

| # | Defecto | Prioridad | Prueba de aceptación |
|---|---|---|---|
| D1 | ~22 controles sin nombre accesible en `/editor/manual?job=…`, 6 en `/videos`, 2 en `/images` y `/studio`, 4 en `/market-intelligence` (el rastreo cuenta controles sin texto, aria-label, título ni etiqueta) | P2 (accesibilidad) | El rastreo A1 devuelve 0 en `unnamed` |
| D2 | Mensajes de error que citan variables de entorno (`GROQ_API_KEY`, `YOUTUBE_API_KEY`) | P2 | Texto reescrito sin nombres técnicos |
| D3 | Miniaturas sugiere «Revisa Conectores», cerrado en la beta | P2 | El texto no remite a páginas cerradas |
| D4 | Dos entradas «Shorts» (`/shorts` Fábrica de curiosidades, `/repurpose`) confunden | P2 | Nombres distintos o una sola entrada |
| D5 | El stack local no concede `channel_connections` (403 gestionado en la interfaz) | Informativo | Sin acción |
| D6 | Google Fonts bloqueadas en el sandbox | Entorno | Sin acción |

Clics sin efecto detectados por A2: en su mayoría falsos positivos (botones que actúan sobre el lienzo o requieren selección previa); el único con error real es «Transcribir» (502 sin proveedor), ya desactivado en la beta con mensaje claro.

## 5. Pruebas realizadas

E2E de módulos con Supabase oficial local: 46/46 antes de P5.24 (M1–M41). En P5.24: rastreo A1 (41 páginas × 2 tamaños: ninguna 5xx, ningún desborde horizontal en móvil), A2 (controles sin efecto), A3 (mensajes tras clic), A4 en modo beta (6/6). Unitarias del alcance beta 15/15. Propuestas SQL 18/18 y lista cerrada de correos 8/8 (commits anteriores). **Pendiente de repetir tras estos cambios:** tsc, ESLint, Vitest completo, E2E completo con recompilación y suite Chromium.

Límites de las mediciones: Chromium sin GPU ni AAC nativo; no medido en el PC de Jesús (3,6 GB de RAM).

## 6. Guion de prueba V1 (cuando haya acceso)

1. Generar medios de demostración: `bash scripts/make-demo-media.sh ./demo-media` (2 clips 720p, 1 imagen, 1 tono).
2. Crear proyecto → subir los 2 clips y la imagen en Biblioteca.
3. «Editar con mi estilo»: elegir 3 materiales → abrir en el editor manual → recortar, dividir, transición, volumen → pegar subtítulos → «Renderizar y guardar» → comprobar el MP4.
4. Guardar como plantilla → crear otra con archivos distintos.
5. `/repurpose`: versión 9:16, reencuadre, subtítulos, exportar.
6. Miniaturas: texto sobre la imagen.
7. Cerrar sesión, volver: todo sigue ahí.

## 7. Acceso para Jesús (Fase H): **BLOQUEADO**

No hay infraestructura autorizada de 0 €: el cupo gratuito de Supabase (2 proyectos activos) está agotado y una segunda cuenta solo se haría con confirmación escrita de Supabase; el despliegue en Vercel necesita credencial del CLI de Jesús. Nada de esto se ha hecho. Decisiones que faltan: (1) autorizar la consulta a Supabase Support, liberar un cupo o aplazar; (2) autorizar el despliegue directo con el CLI y el nombre `cerebro-studio-beta`; (3) lista de correos de testers (inicialmente solo Jesús). Un artefacto de Claude no sustituye a la aplicación completa. Mientras tanto la V1 queda como candidato local preparado.
