# Informe P4.5 — Preparación de un entorno Supabase independiente (Preview)

Presupuesto: 0 €. No se ha creado ningún proyecto, ni migración remota, ni push, ni deploy, ni cambio de variables. Todo lo de abajo es investigación, lectura, desarrollo local y pruebas locales.

## 1. Coste y límites (verificado vs. pendiente)

Verificado en la documentación de Supabase y con `list_projects` (solo lectura):

- Plan Free: hasta 2 proyectos activos gratis entre las organizaciones donde eres Owner/Admin (los pausados no cuentan). 500 MB de BD por proyecto, 1 GB de Storage, ~5 GB de egress, 50 000 MAU. Se pausa solo tras ~1 semana de poca actividad (restaurable durante 90 días). Se puede borrar sin coste.
- La facturación es por organización y los planes no se mezclan dentro de una organización. Las branches (requieren Pro) NO entran en el Spend Cap (~0,013 USD/h en Micro), así que **no son una vía a 0 €**.
- Estado observado: la organización tiene 3 proyectos: Cerebro Studio (ACTIVO), gamemur (ACTIVO), Cazador de Cupones (INACTIVO). Con dos activos, el cupo Free de 2 proyectos activos **ya estaría agotado** si el plan es Free.

**No verificable desde aquí (lo debe comprobar Jesús en el panel):**

1. Plan real de la organización (Billing → Subscription). Si es Pro, un segundo proyecto activo cuesta cómputo extra (no es 0 €).
2. Cuántos proyectos activos cuentan en total (incluidas otras organizaciones donde seas Owner/Admin).
3. Si hay método de pago asociado (relevante para cobros por uso en Pro).
4. Si aceptas pausar o borrar gamemur o Cazador de Cupones (proyectos ajenos a Cerebro; no se han tocado) para liberar cupo. Pausar es reversible; borrar no.

Conclusión de coste: **un segundo proyecto Supabase a 0 € NO está demostrado.** Solo es viable si el plan es Free y se libera un cupo activo.

## 2. Diseño de aislamiento

- Production conserva su proyecto actual (`psbvqdaksrfrkxbewrll`). Preview usa solo un segundo proyecto, con usuarios, datos y archivos sintéticos. No se copian datos reales ni credenciales.
- Estado actual (riesgo): en Vercel, `NEXT_PUBLIC_SUPABASE_URL` y la clave publicable están compartidas entre Production y Preview, y también la service role y las claves de pago. Un Preview hoy toca la base de Production.
- Defensas ya implementadas en código (P4.4, probadas con 86 tests): `previewBlock(kind)` en 36 rutas, `serviceRoleClient()` devuelve null en Preview, topes de gasto en 0 en Preview, política de rutas para las 63 rutas.
- Variables de Preview (alcance solo Preview, nunca Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del proyecto nuevo. NO definir en Preview: `SUPABASE_SERVICE_ROLE_KEY`, FAL, OPENAI, GEMINI, YouTube OAuth, `CRON_SECRET`, claves de publicación.
- Salvaguarda adicional recomendada (por diseñar/probar si se autoriza): en Preview, abortar si la URL de Supabase coincide con la ref de Production (`psbvqdaksrfrkxbewrll`). Es una comprobación de una línea que convierte un error de configuración en un fallo visible en vez de una escritura en Production.

## 3. Migraciones (orden, dependencias, idempotencia, reversión)

Nuevo script local: `scripts/test-migration-chain.sh` (PostgreSQL 16 desechable con stubs de Supabase; nunca toca un proyecto remoto). Aplica las 12 migraciones del repositorio, luego las 7 pendientes, vuelve a aplicar cada pendiente (idempotencia), las revierte en orden inverso y las reaplica.

Resultado: las 7 pendientes son idempotentes y reversibles (36 pasos correctos). Orden: job_queue → storyboard_from_script_rpc → scenes_concurrency_and_reorder → subtitle_unique_per_source → transcription_locks → reserve_generation_spend → research_functions_search_path. Dependencias: reserve_generation_spend necesita `generation_spend` (20261018120000); research_functions_search_path necesita las funciones de 20261013120000; storyboard/scenes necesitan scripts/storyboards/scenes.

**Hallazgo importante (deriva repo ↔ Production):** la cadena de migraciones del repositorio NO reconstruye el esquema real de Production. Fallan sobre una BD nueva: `20261007120000` (no existe `opportunities.source_id`), `20261018120000` (no existe `channel_connections.provider`) y la pendiente `20261102140000` (no existe `assets.asset_type`; el repo tiene `assets.kind`). Producción tiene esas columnas por cambios no versionados. Consecuencia: **un Preview creado aplicando las migraciones del repo no sería equivalente a Production**. El esquema del Preview debe partir de un volcado solo-esquema de Production (lectura), no de la cadena del repo. Recomendación: versionar ese volcado como línea base antes de nuevas migraciones.

## 4. Calidad: ESLint

Antes: 12 errores / 121 avisos (preexistentes). Ahora: **4 errores / 121 avisos**. Reglas intactas, sin desactivar nada globalmente.

Corregidos (8): `prefer-const` ×2 (tests/render-ticket); `use-memo` ×2 en editor-batch (claves estables `scopeKey/optsKey` en las dependencias); `preserve-manual-memoization` en style-panel (`cmpBaseline`); `purity` en oportunidades (`Date.now()` se captura en el clic, no en el render); `rules-of-hooks` en render-panel (`useAppDriveFolder` no era un hook: renombrada a `chooseAppDriveFolder`); `no-unescaped-entities`.

Sin corregir (4), por riesgo: editor-timeline (modificación de `document.body.style` en un gestor de arrastre) y render-panel líneas ~142, ~241, ~415 (heurísticas del React Compiler sobre `run` usada en un efecto, `Math.random` en un id de exportación y estado tras efecto). Mover `run` solo desplazaba los errores a otras líneas (probado y revertido). Arreglarlos exige refactorizar el flujo de exportación MP4, que es crítico; se propone hacerlo con tests dedicados, no a ciegas.

## 5. Pruebas ejecutadas

- `tsc --noEmit`: sin errores.
- `vitest`: 1590 correctas, 22 omitidas (158 archivos).
- Build en entorno limpio: correcto.
- Cadena de migraciones: ver sección 3. PostgreSQL local 64/64, PostgREST 38/38 y S3 (moto) 7/9 + 2 omitidas con motivo, de fases anteriores, sin cambios.
- Suite Chromium: relanzada tras tocar componentes de UI (resultado en el informe de seguimiento).

## 6. Procedimiento de activación (solo con autorización explícita)

1. Jesús comprueba plan/cupo (sección 1) y decide qué proyecto ajeno pausar, o acepta el coste.
2. Crear el proyecto "cerebro-preview" (región cercana a Production).
3. Cargar el esquema desde el volcado solo-esquema de Production + las 7 pendientes en el orden de la sección 3 (solo en Preview). Verificar RLS activa en todas las tablas y probar con dos usuarios sintéticos.
4. En Vercel, variables de alcance Preview únicamente: URL y clave publicable del proyecto nuevo. Retirar de Preview la service role, claves de pago y secretos de cron/OAuth. Separar las dos variables públicas que hoy son compartidas.
5. Verificar el aislamiento antes de permitir escrituras: una petición de Preview debe mostrar la ref del proyecto Preview; la salvaguarda de ref de Production debe estar activa.
6. Publicar los 14 commits locales solo tras autorización expresa.
7. Recorrido autenticado con datos de prueba: login real, persistencia, Storage, RLS, recorrido hasta exportar MP4.
8. Reversión: borrar variables de Preview, pausar/borrar el proyecto nuevo (sin coste).

## 7. Operaciones que requieren autorización

Crear el proyecto Supabase; pausar/borrar uno ajeno; migraciones remotas en Preview; cambios de variables en Vercel; push de los 14 commits locales; deploy; cualquier gasto.

## 8. Recomendación final

No continuar con escrituras de Preview mientras use el proyecto de Production. Siguiente decisión operativa: (a) si el plan es Free y Jesús libera un cupo activo, crear el proyecto Preview con el procedimiento de la sección 6; (b) si no, mantener los 14 commits locales y probar la ruta autenticada solo en local (PostgreSQL + PostgREST ya disponibles), sin desplegar. En cualquier caso, la deriva de esquema (sección 3) debe resolverse con un volcado de línea base antes de confiar en un entorno reconstruido.
