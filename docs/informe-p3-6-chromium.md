# P3.6 — Suite Chromium completa (cierre)
Fecha: 2026-11-01 · rama `fase1-seguridad` (local) · Supabase SIMULADO (mock), no real.

- Ejecutadas 704 comprobaciones en Chromium real (`npm run test:browser`), 704 OK, 0 fallos, 0 omitidas.
- Defecto real encontrado y corregido: al redimensionar por una esquina, el `dragstart` nativo cancelaba el puntero (éxito 40 % → 76 % → corregido con `userSelect:none` + `onDragStart` prevenido en `viewer-handles.tsx`).
- La parada del test de Transiciones fue del arnés (chips fuera de pantalla): se corrigió el test (editar primer corte y reducir zoom), sin subir timeouts ni bajar repeticiones.
- Riesgo ABIERTO (P2): discrepancia intermitente entre exportación en tiempo real y vista previa. No reproducida; sin medición de memoria ni de tiempo real. Evidencia: observada durante la sesión, ausente en la suite final. Se mantiene abierto hasta medirlo en navegador real con sesión real.
- No cubierto: rama WebM en navegador (solo unitarios), conversión local a MP4 (nunca ejecutada), rutas funcionales de Instagram/TikTok.
- No es conformidad WCAG: son comprobaciones estáticas de contraste/nombres/teclado.
