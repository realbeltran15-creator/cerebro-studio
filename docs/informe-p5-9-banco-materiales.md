# Informe P5.9 — Banco de materiales y estabilidad audiovisual (0 €)

## 1. Prueba de tiempo real del laboratorio (diagnóstico limitado)
Resultados de `npm run test:browser:lab`: ejecución inicial (justo tras la suite principal) **1 fallo** en «verify (realtime): la exportación muestra la misma imagen que la vista previa, o el medidor de fidelidad avisa»; ejecuciones aisladas posteriores 1–5: 21/21 correctas cada una; ejecuciones 6–8 con **carga de CPU artificial** (4 bucles ocupando los 2 núcleos): 21/21 cada una. En total 1 fallo en 9 ejecuciones; **no reproducible** ni con carga. El único dato del fallo es una captura de colores exportados por fotograma (p. ej. [208,31,32], [0,200,0], [199,0,200]…) frente a la vista previa, compatible con un desfase de un fotograma en la exportación en tiempo real (depende del reloj del navegador), no con un defecto de color. Sin causa clara: se documenta la limitación y el modo tiempo real sigue **desactivado en la beta**; la exportación rápida no se ha tocado. No se han aumentado timeouts ni relajado pruebas.

## 2. Funciones implementadas
- **Buscador de materiales en la Biblioteca** («Buscar fotos y vídeos gratuitos»): elegir proyecto de destino, fotos o vídeos, banco, buscar, previsualizar, ver autor/licencia/atribución, enlace a la fuente, **Importar**. Reutiliza el componente `StockBrowser` y las rutas `/api/stock/search` e `/api/stock/import` ya existentes (la importación vuelve a leer el elemento del proveedor por id, guarda licencia, autor y fuente, y es idempotente por proyecto).
- **Protección de cuota de Pexels en el servidor**: contador local (refusa al 90 % de 200/hora y 20.000/mes), caché de 5 minutos para consultas idénticas, un 429 no se reintenta. `lib/stock/pexels.ts` aporta el contador, el texto de atribución y el rótulo «Fotos y vídeos proporcionados por Pexels».
- **Sin clave: estado pendiente**: el selector marca «(sin clave)» y explica que falta activarlo; no se hace ninguna llamada.
- **Datos de prueba para tests locales** (`CEREBRO_STOCK_FIXTURE=1`, apagado por defecto y **nunca en la beta privada**): 3 imágenes sintéticas de color, rotuladas «[PRUEBA]» y «DATOS DE PRUEBA: no son resultados de Pexels», servidas por la propia app; no contactan ningún host externo. Solo imágenes (no hay vídeo sintético).

## 3. Resultados de pruebas
- E2E `local-e2e-modules` M25: buscar (con el rótulo de datos de prueba), importar a la Biblioteca (activo `pexels` con licencia, autor y atribución), reimportar no duplica, el material aparece en Miniaturas como base y se recupera como PNG válido por URL firmada tras recargar; sin llamadas externas. **30/30 correctas.**
- Vitest: +9 pruebas (`stock-fixture-safety`, `pexels-prepared`); la política de rutas obligó a registrar la ruta nueva (`preview-guard`).
- tsc 0 errores, ESLint 0 errores, Chromium principal 686/686, laboratorio sin fallos en 8 de 9 ejecuciones (ver sección 1).

## 4. Integraciones
- **Biblioteca → Miniaturas**: verificado de extremo a extremo.
- **Biblioteca → Plantillas / Editor**: los selectores admiten activos de tipo imagen/vídeo, por lo que el material importado (tipo `image`) está disponible; verificado por tipo en código y por las pruebas de compatibilidad, **no** con un montaje completo desde material importado en este informe.
- Aislamiento: la importación exige que el proyecto sea del usuario (`owner_id`) y los activos están bajo RLS (pruebas de aislamiento previas). No se ha añadido una prueba de importación entre dos usuarios.

## 5. Limitaciones
Sin clave real de Pexels no hay resultados reales; los de prueba son solo imágenes. No se ha descargado nada de terceros. Pixabay y Freesound comparten el mismo componente pero siguen sin clave.

## 6. Autorizaciones necesarias
Clave gratuita de Pexels y de YouTube Data (las crea Jesús); decidir si el buscador debe abrirse en la beta (hoy la Biblioteca está abierta pero el banco no tiene clave).
