# Informe P5.18 — Paquete Windows y validación final de la beta local

Rama `beta-privada`, coste 0 €, sin push, sin instalar nada en el PC de Jesús, sin Production.

## 1. Diagnóstico real del PC de Jesús (solo lectura, ejecutado)
`windows/diagnostico.ps1` (se copió a `Descargas\cerebro-diagnostico\`, junto a `comprobar-requisitos.bat`). Resultado medido:

| Requisito | Valor | Veredicto |
|---|---|---|
| Sistema | Windows 11 Pro 64 bits, Intel i5-1035G1 (4 núcleos / 8 hilos) | válido |
| RAM | **3,6 GB totales; 0,4 GB libres** en el momento | **insuficiente** para Docker + Supabase (autoalojado: mín. 4 GB, recomendado 8 GB) |
| Disco C: | **7,3 GB libres** | **insuficiente** (Docker + imágenes piden decenas de GB) |
| Virtualización | activada en firmware; hipervisor inactivo; WSL/VirtualMachinePlatform/Hyper-V **desactivados**; WSL **no instalado** | posible, pero hay que instalar y reiniciar |
| Node.js / npm / Git | v24.19.0 / sí / sí | bien |
| Docker, Supabase CLI, PostgreSQL, ffmpeg | no instalados | — |

**Conclusión:** la ruta «Docker Desktop + `supabase start»` NO es recomendable en este equipo, y no se ha instalado nada. WSL2 tampoco: habría que instalarlo, reiniciar, y WSL2 se reparte la RAM con Windows.

## 2. Alternativa ligera sin Docker
Medido aquí (Linux): todo el stack oficial (PostgreSQL 16, GoTrue, Storage API, PostgREST, pasarela, moto como almacén S3) **más** la app en producción = **≈734 MB de RAM**. En 3,6 GB de RAM es en principio asumible, **cerrando navegador y programas**, pero:
- **No reproducible en Windows desde aquí.** El Auth oficial (GoTrue) debe compilarse para Windows; el intento de compilación cruzada falló porque faltan dependencias exclusivas de Windows y el proxy de módulos de Go no es alcanzable desde este entorno (no se eludió). El resto de componentes (PostgreSQL, PostgREST) tendrían que **descargarse en el PC de Jesús** desde las fuentes oficiales, y moto (Python) se sustituiría por el backend de ficheros del Storage; todo eso necesita tu autorización y no está probado.
- **Disco:** `node_modules` ≈ 844 MB, compilación ≈ 223 MB, Storage ≈ 630 MB; con PostgreSQL cabría en 7,3 GB pero con poco margen.
- **No se recurre a una base simulada** para una beta real.

**Decisión técnica:** hoy no existe un paquete Windows que funcione. Los scripts de inicio/estado/parada para Windows **no se han creado**: un `.bat` que arrancase una app sin backend probado sería engañoso. Lo único entregado y **probado en Windows** es el diagnóstico (`comprobar-requisitos.bat`).

## 3. Seguridad
- La beta rechaza cualquier URL/clave de Production (comprobado en P5.17 y en pruebas Vitest).
- El paquete no contiene claves, secretos ni tokens.
- Las migraciones de propiedad de proyectos y GRANT de `channel_connections` siguen **sin aplicar en remoto** (18/18 en el stack oficial local, con rollback).

## 4. Regresión completa (hoy)
- TypeScript: 0 errores.
- ESLint: 0 errores (141 avisos preexistentes).
- Vitest: 1671 correctas, 22 omitidas (172 ficheros).
- Propuestas de seguridad en stack oficial: 18/18.
- E2E de módulos en stack oficial (con compilación): 43/43.
- Chromium completo (`npm run test:browser`): «All browser checks passed».
- Exportación en tiempo real sigue desactivada.

## 5. Componentes probados / no probados
- Probados: diagnóstico en Windows real; script `beta-local.sh` en Linux; regresión completa.
- No probados: cualquier instalación de la app o de Supabase en Windows.

## 6. Opciones para Jesús (requieren su decisión)
1. **Liberar espacio y memoria** (≥ 20 GB de disco, cerrar programas) y autorizar la descarga de binarios oficiales de PostgreSQL y PostgREST para Windows, más una compilación de GoTrue para Windows hecha en un equipo con acceso a los módulos de Go.
2. **Usar otro ordenador** con ≥ 8 GB de RAM y ≥ 40 GB libres, y entonces Docker Desktop + Supabase CLI.
3. **Probar la app en este entorno** y verla mediante una vía autorizada por Jesús (sin exponer puertos ni crear túneles públicos).
4. Alojamiento externo gratuito: requiere cuenta y, en Oracle, tarjeta; no autorizado.

## 7. Instrucciones sencillas hoy
Haz doble clic en `Descargas\cerebro-diagnostico\comprobar-requisitos.bat` para repetir el diagnóstico (solo lee; no instala nada).
