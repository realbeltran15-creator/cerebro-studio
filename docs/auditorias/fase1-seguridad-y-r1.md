# Fase 1 (seguridad) y regresión R-1 de Investigación · implementado sobre `205c978` · 17-10-2026

Lo implementó Claude (Cowork, auditor), porque esta sesión no puede hacer push. Se entrega como parche para que Claude Code lo revise, lo aplique en `feat/creation-studio` y lo despliegue en Preview.

Comprobado sin gastar nada:
- `tsc --noEmit` limpio.
- `vitest`: 828 correctas y 1 fallo ajeno (`vendored-ffmpeg`: en mi copia no está instalado `@ffmpeg/ffmpeg`).
- ESLint sin errores.

**Sin migraciones, gasto ni publicación real.**

## 1. Aprobaciones de publicación imposibles de falsificar desde el navegador (P1-1 y P1-2)

**Problema.**
- Las políticas RLS `approvals_owner_all` y `publication_jobs_owner_all` son `for all`. Con la sesión del dueño, o mediante un XSS, se podía insertar `approvals.status='approved'` y poner `publication_jobs.status='approved'` sin pasar por «APROBAR» ni por la comprobación de licencias.
- Además, se podía cambiar el `payload` después de aprobar: privacidad `public`, otro vídeo, otro texto.

**Solución sin migración.** Un **sello HMAC calculado en el servidor**:
- Archivos: `lib/publication/seal.ts` y `lib/publication/approval.ts`.
- Al aprobar (`/api/publish/{youtube,social}/[jobId]/approve`), el servidor firma exactamente lo aprobado: dueño, trabajo, plataforma, clave de idempotencia, `payload` canónico y **ruta del archivo de vídeo**.
  - La firma usa una clave que solo conoce el servidor: `PUBLICATION_SEAL_KEY` o, si no existe, una clave derivada de `TOKEN_ENCRYPTION_KEY`.
  - El sello se guarda en `publication_jobs.result.approvalSeal`.
- Al publicar (`publishJob` y `publishSocialJob`), se recalcula sobre el trabajo **actual**. Si no coincide, devuelve **403**: «La aprobación no corresponde al contenido actual… vuelve a aprobarlo».
  - Esto bloquea las filas falsificadas, los payloads cambiados y los archivos sustituidos tras la aprobación.
  - Copiar un sello antiguo solo sirve para el mismo contenido que se aprobó de verdad.
- Si un trabajo aprobado tiene el sello roto, por cambios o porque se aprobó antes de esta versión, **se puede volver a aprobar**. Los trabajos ya aprobados antes de este cambio necesitan una nueva aprobación.
- Si la subida falla, el sello se conserva (antes `result` se sobrescribía), así que el reintento sigue protegido.

**Pruebas:** `tests/security-and-publishing.test.ts` (6 casos nuevos) y `tests/text-stt-social.test.ts` (1 nuevo):
- aprobación falsificada sin sello;
- `private` cambiado a `public`;
- archivo sustituido;
- reintento tras un fallo;
- estabilidad del JSON canónico;
- sello imposible sin la clave.

**Endurecimiento recomendado en la base de datos.** Es una segunda capa y requiere autorización y revisión; **no está aplicado ni incluido como migración**:

```sql
-- El cliente deja de poder escribir el estado de publicación y las aprobaciones; solo el servidor (service role o RPC security definer).
drop policy if exists approvals_owner_all on public.approvals;
create policy approvals_owner_read on public.approvals for select using (owner_id = auth.uid());
drop policy if exists publication_jobs_owner_all on public.publication_jobs;
create policy publication_jobs_owner_read   on public.publication_jobs for select using (owner_id = auth.uid());
create policy publication_jobs_owner_insert on public.publication_jobs for insert with check (owner_id = auth.uid() and status in ('draft','awaiting_approval'));
create policy publication_jobs_owner_update on public.publication_jobs for update using (owner_id = auth.uid() and status in ('draft','awaiting_approval'))
  with check (owner_id = auth.uid() and status in ('draft','awaiting_approval'));
-- Después, las rutas approve/publish deben escribir con un cliente de servicio (o RPC) en vez de la sesión del usuario.
```

## 2. Topes de gasto en el servidor (E-2)

Archivo: `lib/providers/spend.ts`. Se aplica en `/api/studio/generate` antes de llamar al proveedor.

- **Topes:** diario y mensual en USD, configurables con `GENERATION_DAILY_CAP_USD` (por defecto 5) y `GENERATION_MONTHLY_CAP_USD` (por defecto 25). El valor `0` desactiva las generaciones de pago.
- **Qué cuenta como gastado:**
  - la estimación de cada recurso generado de pago, con la misma regla que `/usage`;
  - los trabajos en cola todavía sin resultado.
- **Qué no cuenta:** créditos prepagados (Higgsfield, ElevenLabs, Alibaba) y niveles gratuitos, porque no son gasto en efectivo.
- **Si no se puede leer el gasto:** no se envía nada y devuelve 503. Si se supera el tope, devuelve **402** con el detalle.
- **Pruebas:** `tests/spend-and-job-ledger.test.ts`, que incluye la ruta (no se llama al proveedor cuando se supera el tope).

## 3. Los trabajos de pago ya no se pierden al cerrar el navegador (E-1)

Archivo: `lib/providers/job-ledger.ts`.

- Cada trabajo en cola se registra **en el servidor**, en la fila `connector_configs` del dueño (provider `cerebro-studio`, capability `generation_jobs`).
  - Es una tabla existente con RLS por dueño, así que **no hace falta migración**.
  - Se guarda el token cifrado.
- `/api/studio/job` marca el trabajo como `done`, `failed` o `expired`.
- La nueva ruta `GET /api/studio/jobs` lista los pendientes.
- Al abrir el Estudio se **recuperan** los trabajos que el navegador no conoce: pestaña cerrada, almacenamiento borrado u otro dispositivo.
- Si no se puede registrar, la página avisa de no cerrar la pestaña.
- **Límites:**
  - escritura optimista con 3 reintentos;
  - máximo 100 entradas;
  - los trabajos expiran a las 48 h y los terminados se purgan a los 7 días.
  - A largo plazo conviene una tabla propia (`generation_jobs`).

## 4. Investigación R-1 (motor 7)

**Problema.** En «AI tools for beginners», la palabra «ai» de la consulta contaba como prueba de que el vídeo trataba de herramientas de IA. Por eso entraban «Earning money with Ai !» (un Short de 46,7 M de vistas en la muestra real) y «What is AI? explained».

**Solución** (`relevance.ts`): para el crédito de dominio solo cuentan las pistas del título que **no son palabras de la propia consulta**. Se añaden «ai studio» y «google ai studio» como nombres de herramientas. `ENGINE_VERSION` pasa a 7.

**Pruebas** (`tests/research-ai-tools.test.ts`):

| Títulos | Resultado esperado |
|---|---|
| «Earning money with Ai !», «What is AI? explained», «AI will change everything» | Descartados |
| «FULL Claude Tutorial…», «Ultimate Beginner's Guide to Claude AI», «Google AI Studio Tutorial…», «5 FREE AI Tools…», «How to use ChatGPT…» | Aceptados |

Los casos de vivienda en EE. UU. siguen aceptados.

## 5. Otros cambios de seguridad e indicadores honestos

- `proxy.ts`: se añaden al `matcher` `/social`, `/connectors`, `/campaigns` y `/shorts`, que estaban como protegidas pero no se filtraban.
- `/api/providers/status` ahora exige sesión. Todas sus llamadas salen de páginas autenticadas.
- `lib/module-status.ts`: Estudio IA, Música/SFX, Miniaturas, Convertir a Shorts, Biblioteca y Costes pasan de «Funcional» a **«Parcial»**, con lo que falta verificar.

## 6. Qué falta para dar la Fase 1 por cerrada (verificación real en la Preview)

1. Desplegar en Preview (Code) y comprobar con un trabajo de YouTube en borrador:
   - aprobar;
   - cambiar la privacidad desde la base de datos o la consola → «Publicar» debe dar 403;
   - volver a aprobar → se desbloquea.

   **Sin publicar.** No hace falta pulsar «Publicar» con un payload válido.
2. Comprobar el tope de gasto sin gastar: con `GENERATION_DAILY_CAP_USD=0` en Preview, una generación de pago debe dar 402 sin llamar al proveedor.
3. Comprobar la recuperación de trabajos con un modelo gratuito en cola, si existe alguno, o con el primer trabajo de pago autorizado.
4. Decidir si aplicar el endurecimiento RLS de la sección 1. **Necesita autorización.**
