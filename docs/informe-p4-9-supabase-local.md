# Informe P4.9 — Validación oficial de Supabase Auth y Storage en local

Presupuesto: 0 €. Sin push (19 commits locales sin publicar), despliegue, proyecto Cloud, migración remota ni cambio en Production o en Vercel. Solo usuarios, archivos y proyectos sintéticos; ninguna credencial real; nada copiado de la base real. El stack no tiene conexión con ningún proyecto remoto.

## 1. Viabilidad de Docker

- **PC de Jesús: no viable.** 3,6 GB de RAM, 7 GB libres en C:, sin WSL2 ni Docker. Docker Desktop (WSL2) reserva ~2 GB solo para la VM y el stack oficial de Supabase arranca ~10 contenedores: dejaría el equipo sin margen. Se cierra esa vía; no se instaló nada.
- **Sandbox: Docker arranca, pero no puede descargar imágenes** (los registros de contenedores devuelven 403). Es una restricción de red, no de recursos.
- **Vía práctica elegida (gratis, sin simulador):** compilar desde el código fuente oficial los mismos servicios que usa Supabase y ejecutarlos sin contenedores.

## 2. Servicios usados y qué es real

| Componente | Origen | Real / sustituto |
|---|---|---|
| Auth | `supabase/auth` (GoTrue) **v2.180.0** compilado desde fuente (binario Go) | **Oficial** |
| Storage | `supabase/storage-api` **v1.40.0** compilado desde fuente (Node) | **Oficial** |
| REST | PostgREST **12.2.3** (binario) | **Oficial** |
| Base de datos | PostgreSQL **16** | **Real** |
| Objetos (backend de Storage) | `moto` (S3 en memoria, 127.0.0.1:5555) | **Sustituto** del disco/S3 del Storage |
| Pasarela `/auth/v1`, `/rest/v1`, `/storage/v1` | `scripts/official-supabase-gateway.mjs` | **Enrutador** que sustituye a Kong; no interpreta cuerpos. Solo añade CORS, `X-Forwarded-*` y reescribe `https`→`http` en la cabecera `Location` de TUS |
| Confirmación de correo | `GOTRUE_MAILER_AUTOCONFIRM=true` | **No probada** |
| Realtime, imgproxy/transformaciones, Studio, Edge Functions | no usados | **No probados** |

Esquema de la aplicación: `baseline_live.sql` + 7 pendientes + disparador `on_auth_user_created`, aplicados **sobre los esquemas `auth` y `storage` reales** (no sobre el stub). El bucket privado `generated-assets` y las 4 políticas RLS de `storage.objects` quedan operativos en el Storage oficial.

### Desviaciones al compilar (honestidad sobre lo que no es idéntico a la imagen oficial)
- Auth: la etiqueta HEAD pide Go 1.27 (no disponible); se usó v2.180.0 (Go 1.23) y los módulos Go de hosts bloqueados se resolvieron con clones locales (`replace`).
- Storage: HEAD exige Node ≥ 26; se usó v1.40.0. Dependencias sin `package-lock` (bloqueado por la red), dos dependencias git sustituidas por clones locales, `fs-xattr` (nativo, solo del backend de ficheros) sustituido por un stub inerte, `knex` fijado a 3.1.0 para aplicar su parche, y compilación con esbuild + `resolve-tspaths` **sin la comprobación de tipos** (`tsc`).
- Storage se inicia una primera vez con rol superusuario solo para migrar; después se retira el superusuario, se ajustan propietarios y se reinicia (ver `scripts/official-stack.sh`). **Todas las pruebas se ejecutan con el rol sin privilegios.**
- Privilegios por defecto de `anon/authenticated/service_role` sobre `public`: los crea la plataforma Supabase en cada proyecto y **el esquema depende de ellos**; no están en el baseline. Se reproducen en el arranque del stack. **Nota de despliegue:** vale en un proyecto Supabase nuevo; no en una base PostgreSQL cualquiera.

## 3. Reproducir

`bash scripts/test-official-supabase.sh` (stack desde cero en ~12 s, valida y lo apaga). `JOURNEY_SCRIPT=local-e2e-editor.mjs` ejecuta el E2E audiovisual. Requiere las compilaciones previas en `/tmp/supa-src` (Auth, Storage), `/tmp/postgrest-12.2.3` y `moto_server`; los pasos de compilación y desviaciones están en esta sección.

## 4. Pruebas ejecutadas

**Trayecto de datos con `@supabase/supabase-js` real: 51/51** (los 35 de P4.6 contra servicios oficiales + 16 solo oficiales): alta, login, contraseña errónea, `getUser`, renovación con rotación de token, **cierre de sesión global que revoca los refresh tokens**, **recuperación de sesión** (`setSession`), registro duplicado, JWT emitido por Auth aceptado por PostgREST y Storage, firma alterada rechazada, perfil creado por el disparador real, proyecto → guion → storyboard (RPC) → escenas → MP4 → biblioteca → render job, persistencia tras cerrar sesión y bytes idénticos, **aislamiento entre usuarios y anónimo con la RLS real de `storage.objects`**, URL firmada de descarga y de subida, URL firmada manipulada y caducada rechazadas, **subida reanudable TUS** (5 MB + reanudación con HEAD + resto, byte a byte), TUS ajeno rechazado, límite de 50 MB, borrado seguro (solo el dueño; el objeto desaparece de `storage.objects`), borrado en cascada.

**E2E audiovisual con la app real (Next.js + Chromium + FFprobe), beta ON, contra Auth/Storage oficiales: 21/21.** Login → Proyecto → Guion → Storyboard → Importación (vídeos, imagen, audio WAV por TUS) → Editor → Música → MP4 (480p, 24 fps, ruta rápida) → comprobación con FFprobe (+ decodificación completa con ffmpeg: H.264/AAC, duración ≈ 28 s) → Biblioteca → Logout → Login → Recuperación → aislamiento con otro usuario → fallo controlado cuando un medio desaparece del Storage y recuperación al restaurarlo → guardas de configuración (arranque rechazado con configuración de Production o claves de pago).

### Intermitencia propia encontrada y corregida (no del producto)
Durante las repeticiones, el paso 18 falló en 5 de 17 ejecuciones. Se instrumentó (volcado de `render_jobs`) y se capturó el estado: el bucle de espera del test leía el `status` y el recuento de trabajos en **dos consultas separadas**; si el trabajo nuevo (`rendering`) se insertaba entre ambas, el test emitía el veredicto con el estado antiguo (`completed`). Es una carrera del arnés, no del producto (el trabajo terminaba después en `failed` con aviso, como se espera). Se unificó en una sola consulta. **Tras la corrección: 8/8 ejecuciones seguidas 21/21** (antes de ella: 5 fallos en 17). La corrección no relaja ninguna comprobación.

## 5. Estado de Chromium (suite de 705 comprobaciones)

Tres ejecuciones seguidas en esta fase: **705/705, abortada, 705/705.** La abortada fue por un `TimeoutError` de interfaz en la búsqueda de herramientas del Editor (la opción «Recortar / duración» se vuelve a pintar mientras Playwright intenta pulsarla: «element was detached from the DOM, retrying»), **distinta** de la de P4.8. Causas identificadas por lectura del código y de los registros:

1. `renderer: fade goes to black` (`fadeEdge` indefinido en P4.8): la muestra solo se toma si una llamada de progreso cae en una ventana de **60 ms** (1970–2030 ms) en el modo tiempo real, que depende del reloj. Con la CPU saturada (VM de 2 núcleos) puede no caer ninguna llamada y la muestra queda sin definir. Es fragilidad de la ventana de muestreo, no defecto de datos.
2. `real-time vs preview` y similares (P4.6): mismo origen, temporización del modo tiempo real bajo carga.
3. La caída de interfaz de esta fase es una carrera de repintado de la lista de resultados durante el clic.

**Conclusión: la suite Chromium NO se declara estable.** Pasa en la mayoría de ejecuciones pero no de forma determinista en esta VM. El modo tiempo real está desactivado en la beta, y el camino que usa la beta (exportación rápida, exacta por fotograma) está cubierto por el E2E (8/8). No se tocaron tiempos ni cobertura. Propuesta (no aplicada, requiere decisión): separar las pruebas de tiempo real en un grupo «laboratorio» que no bloquee el candidato, y estabilizar el clic de la búsqueda esperando a que la lista deje de repintarse.

## 6. ESLint

**2 errores, sin cambios** (`render-panel.tsx`: `run` usada en el efecto de autoarranque antes de su declaración, línea ~146; modificación de `pendingDriveRef` ~423). Intenté de nuevo una solución sin desactivar reglas (reordenar el efecto, la referencia y `sendToDrive`): el compilador de React desplazó el problema y **subió a 4 errores** (llamadas impuras durante el render y otro acceso previo a la declaración), así que **lo revertí**; el archivo es idéntico al original. Resolverlo exige reestructurar la exportación y el flujo de Drive (no probable localmente) con pruebas de comportamiento. Ninguna regla desactivada.

## 7. Recursos consumidos y coste

Stack completo en reposo: ≈ 505 MB de RAM (Storage 221, PostgreSQL 102, moto 77, pasarela 55, Auth 29, PostgREST 21); 12 s para arrancar desde cero. Compilaciones y dependencias en disco: ~1,4 GB (`node_modules` de Storage 623 MB, clones 733 MB), binario de Auth 41 MB. **Coste: 0 €.** Ningún servicio de pago ni de pago por uso.

## 8. Limitaciones y lo que sigue simulado

- Backend de objetos: S3 simulado (moto) en vez del almacén real; RLS, políticas, firmas y TUS sí son del Storage oficial. No se prueban latencia, consistencia ni límites de un S3 real.
- Pasarela de rutas propia en lugar de Kong (sin limitación de tasa ni reglas de Kong).
- Confirmación de correo, límites de tasa de Auth, OAuth y MFA: no probados.
- Compilaciones con dependencias no fijadas y sin `tsc`: no son bit a bit las imágenes oficiales.
- Realtime, transformación de imágenes, Studio: no usados. Safari/Firefox: no validados.
- Entorno Windows de Jesús: no probado; la vía solo se ejecutó en Linux.

## 9. Bloqueantes restantes

1. Confirmar contra un **proyecto Supabase real e independiente** el trayecto de verdad con correo y límites reales (la única forma de cubrir lo de §8). El cupo gratuito parece agotado (no verificado; lo comprueba Jesús en el panel).
2. Variables Supabase y claves de pago/privilegiadas siguen compartidas entre Production y Preview en Vercel: hay que separarlas antes de cualquier despliegue.
3. 2 errores de ESLint y la intermitencia de Chromium (§5–6).
4. 3 migraciones de Production ausentes del repo (solo se reproduce su efecto estructural).

## 10. Decisión necesaria a continuación

(a) Autorizar un proyecto Supabase independiente (tras confirmar plan y cupo) para validar correo y límites reales, o dar por suficiente la validación local oficial para una beta cerrada; (b) decidir si el grupo de pruebas de tiempo real pasa a «laboratorio» y si se asigna una sesión a reestructurar la exportación/Drive para eliminar los 2 errores ESLint; (c) autorizar, por separado, el push de los commits y el Preview con variables solo de alcance Preview.
