# Informe P5.17 — Infraestructura de la beta privada

Rama `beta-privada`, coste 0 €, sin push, sin cuentas ni proyectos externos, sin tocar Production.

## 1. Comparación de opciones de coste cero

| Opción | Qué dicen las fuentes oficiales | Riesgo / límite |
|---|---|---|
| **Local en tu PC** (Docker Desktop + Supabase CLI, o el stack oficial sin Docker en WSL2/Linux) | Supabase CLI: en Windows/Linux necesita Docker Desktop (o Rancher/Podman); `supabase start` / `supabase stop`; Node 20+ si se instala por npm. No publican mínimos de CPU/RAM para el CLI. | Solo funciona con tu PC encendido. El primer arranque descarga imágenes (tiempo y disco). |
| **Supabase autoalojado en una VM gratuita** | Guía oficial de self-hosting: mínimo 4 GB RAM / 2 núcleos / 40 GB, recomendado 8 GB / 4 núcleos / 80 GB; puerto 8000 en HTTP (hace falta proxy TLS); hay que cambiar todos los secretos por defecto. | Requiere administrar un servidor y su seguridad. |
| **Oracle Cloud Always Free** (única VM gratuita revisada) | Doc. oficial: A1 ARM = 2 OCPU y 12 GB en total; 2 VM AMD de 1 GB; 200 GB de disco; pueden reclamar instancias inactivas 7 días (CPU p95 < 20 %, red < 20 %, memoria < 20 % en A1). FAQ oficial: **exige tarjeta** (no admite prepago/virtual); cuentas inactivas ≥ 30 días pueden suspenderse; sin soporte ni SLA; si se supera el límite A1 las instancias sobrantes se eliminan a los 30 días. Un agregador de terceros (no oficial) indica que el límite A1 pasó de 4 OCPU/24 GB a 2/12 el 18-ago-2026; la doc. oficial muestra ya 2/12. | Requiere crear una cuenta y dar una tarjeta (prohibido sin tu autorización). Una VM de 1 GB no basta para Supabase. Con 12 GB sí cabría, pero la disponibilidad de capacidad no está garantizada. |
| **Otros alojamientos gratuitos** | **No investigados** a fondo en esta fase (no hay datos oficiales verificados). | No se recomienda nada sin verificar límites, suspensión y tarjeta. |

La VM gratuita **no se da por viable**: tarjeta obligatoria, capacidad no garantizada, reclamación por inactividad y administración propia.

## 2. Preparación local (probada)

Nuevo `scripts/beta-local.sh` con `up`, `status`, `down`:
- **Comprobaciones previas:** herramientas necesarias, memoria libre (≥ 2500 MB) y puertos 54321, 3100, 54400, 3000, 5000, 9999 y 5555. Si algo falla no arranca nada y dice qué.
- **Configuración:** ejecuta `check-beta-config` antes de arrancar; rechaza URL/clave de Production, claves de pago y claves privilegiadas.
- **Aislamiento:** todo escucha en 127.0.0.1; sin túneles; sin arranque automático ni servicios permanentes.
- **Apagado:** `down` detiene la app, PostgreSQL, Auth, Storage, REST y la pasarela, y deja `status` en «down» (verificado).
- **Medido (esta máquina, 8 GB, 2 núcleos):** arranque completo hasta página abierta **14,8 s**; memoria en uso pasa de ≈0,7 GB a ≈1,15 GB con todo arrancado; `/login` responde 200.
- **Datos:** sintéticos; se borran al volver a arrancar (el script de arranque reinicia la base).

**Límite honesto:** este stack oficial sin Docker está compilado en este entorno Linux (`/tmp/supa-src`) y **no es portable tal cual a Windows**. Para tu PC Windows el camino realista es Docker Desktop + Supabase CLI (`supabase init`, `supabase start`, aplicar `supabase/beta/schema-beta.sql`, `supabase stop`) más `npm run build` / `npm start` con las tres variables de `.env.beta.example`. **No lo he podido probar aquí** (no hay Docker en marcha ni Windows); la validación hecha aquí es del mismo software en Linux.

## 3. Seguridad

- `check-beta-config` rechaza una URL con la referencia de Production (`psbv…`) y acepta `http://127.0.0.1:…` (comprobado).
- Nuevo `scripts/official-proposals-check.mjs` (se lanza con `JOURNEY_SCRIPT=official-proposals-check.mjs bash scripts/test-official-supabase.sh`): usuarios reales de GoTrue y PostgREST oficial. **18/18 correctas:** antes de la propuesta B inserta activos en el proyecto de A (defecto reproducido); después queda bloqueado (activos y trabajos de exportación), B sigue pudiendo usar su proyecto y la Biblioteca general; A lee `provider,status` pero no `token_ciphertext`, `token_metadata`, `owner_id` ni `*`, y no puede escribir; B no ve la conexión de A; el rollback restaura el comportamiento previo; reaplicar dos veces es idempotente.
- Además, en PostgreSQL desechable: propiedad 12/12 y channel_connections 16/16.
- **Nada aplicado en remoto.** Ambas migraciones siguen pendientes de tu autorización.
- Observación: el stack local no concede por defecto el GRANT de `channel_connections` que sí existe en Production; por eso «antes» el acceso daba 403 aquí (informativo, no fallo).

## 4. Prueba de acceso en localhost
Arranque con `beta-local.sh up`, `status` con los cuatro servicios y la app en 200, `/login` 200. Las funciones principales se validan con la suite E2E ya existente (43/43 en P5.16); no se repitió en esta fase.

## 5. Recomendación
**Mejor alternativa de coste cero: ejecución local en tu PC.** Es la única que no exige cuenta, tarjeta ni exposición a Internet.
- *Requisitos:* ≥ 8 GB de RAM, Docker Desktop (Windows) y Node 20+; unos 5–10 GB de disco para imágenes.
- *Riesgos:* depende de tu PC; la ruta Windows está sin probar.
- *Necesitan tu autorización:* instalar Docker Desktop y Supabase CLI en tu PC; aplicar las dos migraciones en cualquier base remota; cualquier cuenta o tarjeta (Oracle u otros); credenciales Google/Meta.

## 6. Guía simple (Linux/WSL2, probada)
1. Iniciar: `bash scripts/beta-local.sh up` → abre `http://127.0.0.1:3100`.
2. Ver estado: `bash scripts/beta-local.sh status`.
3. Cerrar: `bash scripts/beta-local.sh down`.
Un acceso directo para Windows no se ha creado porque no se puede probar aquí.

## 7. Pendiente
Ruta Windows (Docker Desktop) por verificar en tu PC; alojamientos gratuitos distintos de Oracle sin investigar; Chromium (686) no repetida tras P5.16/P5.17.
