# P3 — Navegación, accesibilidad y rendimiento (informe parcial)

Etiquetas: (E) comprobación estática del código, (R) comprobado en el Preview real (solo sin sesión), (M) medido en el build local. Ninguna es una prueba E2E con sesión iniciada.

## Preview (79cfe00) — (R)
Despliegue READY. Sin sesión: /login carga; /editor, /studio, /social, /youtube, /library, /automations y /shorts redirigen; /api/studio/generate y /api/publish/social/.../approve responden 405 a GET (solo POST); /api/providers/*, /api/queue/claim, /api/cron/* y /api/connectors/status no existen (404). NO se probó nada con sesión iniciada (no se introducen contraseñas), ni se ejecutó ninguna acción de pago o publicación.

## Estados (P2.6 + editor)
`lib/operation-presentation.ts`: publicación, trabajos del influencer, automatizaciones, Shorts y ahora renders/exportaciones del editor. «Completado y verificado» exige archivo guardado (output_asset_id); un render terminado sin archivo en la Biblioteca o interrumpido es «Incierto». Los mensajes de la exportación del navegador ya indicaban tamaño y destino; no se cambiaron.

## Navegación — (E)
tests/routes-static.test.ts: 144 referencias internas literales; ninguna ruta rota (se comprobó que el test detecta una ruta inventada). No cubre enlaces construidos dinámicamente.

## Accesibilidad — (E)
tests/a11y-static.test.ts (campos, imágenes, botones sin texto, elementos clicables sin teclado) y tests/contrast-tokens.test.ts (texto, foco y colores de estado ≥ AA sobre los tres fondos). Sin lector de pantalla ni axe en navegador real.

## Rendimiento — (M)
JS inicial por ruta (sin comprimir): mediana ≈ 330 KB; mayores: /editor/manual 885 KB, /market-intelligence 566 KB, /editor/style 511 KB, /shorts 508 KB. mediabunny y el codificador AAC ya se cargan bajo demanda (import dinámico). No se ha optimizado nada todavía: sin medición en navegador (memoria, renders) no hay base para afirmar mejoras.
