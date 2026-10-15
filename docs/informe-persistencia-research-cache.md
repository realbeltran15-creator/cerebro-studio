# Auditoría de persistencia: `research_cache`

Fecha: 2026-10-15 · Estado: **migración NO aplicada**. Evidencia: `tests/research-engine.test.ts` («research_cache persistence…», 5 pruebas contra una tabla simulada con las mismas restricciones), `supabase/tests/migrations_check.sql` (PostgreSQL local desechable, `npm run test:migrations`) y lectura del código (`lib/research/cache.ts`, `sample.ts`).

## 1. Qué datos persiste
Una tabla, `public.research_cache`, dos tipos de fila (`kind`):

| `kind` | Qué contiene | `units` | Caducidad |
|---|---|---|---|
| `topic` | El **análisis ya calculado** de un tema en un mercado: índices, veredicto, evidencia, calidad de la muestra, **todos los vídeos examinados con su estado y motivo**, 9 vídeos de ejemplo, términos y crecimiento. Clave `v2|topic|tema|país|idioma|ventana`. | 0 (el gasto se anota aparte) | 7 días |
| `usage` | Una línea por llamada de pago a YouTube (análisis = 2 × 102, búsqueda libre = 102, lista de tendencias = 2, medir crecimiento = 102). Sin contenido. | las unidades | 2 días |

No guarda las respuestas en bruto de YouTube, ni claves, ni cabeceras (prueba: el JSON no contiene `api_key`/`authorization`). Cada fila es de un usuario (`owner_id`); la RLS impide ver las de otro.

Además, **fuera de la base de datos**, el navegador conserva (`localStorage`): los análisis (para reanudar la investigación guiada), la cola guiada y el contador diario local. Eso no depende de la migración.

## 2. ¿Sobreviven los resultados a un despliegue?
| Situación | ¿Sobrevive? |
|---|---|
| **Con la tabla** (migración aplicada) | **Sí.** Está en Supabase, no en el servidor: una instancia nueva tras un despliegue lee la misma fila y responde desde caché con 0 llamadas a YouTube (prueba «a result survives a new deployment»). Tras 7 días se vuelve a consultar. |
| **Sin la tabla** (estado actual) | **No en el servidor.** Cae a una memoria por instancia que se pierde en cada arranque o despliegue, y no se comparte entre instancias; la pantalla lo avisa («contador en memoria»). Los análisis siguen en el navegador de quien los hizo. |
| Cambio de reglas de análisis | La clave lleva versión (`v2`): los análisis hechos con reglas anteriores no se reutilizan. |

## 3. Cómo evita consultas duplicadas
1. **Caché** por (usuario, clave): un tema/mercado/ventana ya consultado no vuelve a gastar durante 7 días.
2. **Solicitudes simultáneas idénticas** comparten una sola consulta (`inflight`).
3. **Cola por usuario**: las consultas de pago de un mismo usuario van de una en una, de modo que la comprobación de presupuesto y la escritura no se solapan.
4. **Clave única** `(owner_id, cache_key)` en la base de datos: ni dos pestañas ni dos instancias pueden crear dos filas del mismo análisis (el `upsert` reemplaza; probado en SQL).
5. Un **refresh** manual sobrescribe la fila pero **sí se cuenta** (dos líneas de uso).
Límite conocido: 2 y 3 funcionan dentro de una instancia de servidor; entre instancias distintas el amparo es la clave única, pero dos instancias a la vez podrían pagar ambas el mismo análisis una vez.

## 4. Cómo controla el gasto de cuota
- Presupuesto diario (`RESEARCH_DAILY_UNIT_CAP`, por defecto 6.000 de las 10.000 que da YouTube al proyecto), contado desde las 00:00 UTC con la **suma de `units`** de las filas del día.
- Se **rechaza antes de gastar** (HTTP 429) si la consulta superaría el tope; también las búsquedas libres.
- Cada llamada que llegó a YouTube se anota **al terminar**, aunque la siguiente falle o falle la escritura de caché (no se pierde ni se cuenta de menos).
- Contador local del navegador como segunda barrera, con cambio de día automático.
- Con la tabla, el contador es **compartido y persistente** entre instancias y despliegues; sin ella, solo vale dentro de la instancia.

## 5. Qué tablas o políticas modifica
- **Crea** `public.research_cache` (columnas: `id`, `owner_id`→`auth.users` con borrado en cascada, `cache_key`, `kind`, `payload jsonb`, `units ≥ 0`, `fetched_at`, `expires_at`; única `(owner_id, cache_key)`), el índice `research_cache_owner_fetched_idx (owner_id, fetched_at desc)`, activa **RLS**, **retira los privilegios de `anon`** y crea la política `research_cache_owner_all` (solo `authenticated`, `owner_id = auth.uid()`).
- **No modifica** ninguna tabla, política, función ni trigger existente. No toca `projects`, `opportunities`, `trend_snapshots` ni Storage.
- Limpieza: de forma ocasional el servidor borra las filas del propio usuario caducadas hace más de 30 días.

## 6. Cómo se revierte
`supabase/rollback/20261013120000_research_cache.sql` → `drop table if exists public.research_cache;`. Pierde solo datos regenerables (caché y registro de uso del día). Probado en la base local: tras el rollback la tabla no existe y `projects` queda intacto. La app vuelve sola al modo memoria.

## 7. Qué se ha probado y qué no
Probado: lógica de caché, deduplicación, tope y reinicio diario contra una tabla simulada fiel a las restricciones; el SQL real (idempotencia, RLS, restricciones, upsert, suma diaria, caducidad, rollback) en PostgreSQL 16 local con los roles y `auth.uid()` simulados.
**No probado**: la migración sobre la base real compartida (PostgreSQL 17.6, con PostgREST), ni el comportamiento con varias instancias de Vercel a la vez.

## 8. Recomendación
Aplicarla cuando lo autorices: es aditiva, reversible, no toca tablas existentes y convierte el presupuesto y la caché en persistentes. Pasos y comprobaciones en `docs/informe-migraciones.md`.
