# Matriz de operatividad real de los 30 módulos (P5.5) y alternativas de infraestructura

Evidencia: auditoría de uso con la app real (Next.js + Chromium) y Auth/Storage/PostgREST oficiales en local, beta apagada, sin ninguna clave de proveedor (`npm run test:audit:beta`, `AUDIT_ALL=1`, `PROBE=1`), E2E del editor 21/21, Chromium 686. Presupuesto 0 €. «Probado» = ejercitado de principio a fin en local; «Carga» = la página abre, sin errores de aplicación y sin desbordar en móvil (375/390 px) pero su flujo completo no se ha ejecutado.

| Módulo | Estado | Evidencia y límite real |
|---|---|---|
| Inicio `/` | Operativo | Probado. Con la propuesta de permisos (local) desaparece el 403 de conexiones |
| Proyectos `/projects` | Operativo | Probado (crear, recuperar tras cerrar sesión) |
| Guiones `/scripts` | Operativo (sin IA) | Probado: crear v1, editar, convertir en storyboard. La asistencia de IA exige clave de texto: bloqueado |
| Storyboard `/create` | Operativo | Probado (escenas desde guion); crear vacío exige proyecto |
| Editor `/editor` | Operativo | Probado de principio a fin: importar, montar, exportar MP4 (FFprobe y decodificación) |
| Editor manual | Operativo | Probado en el E2E y 686 comprobaciones Chromium |
| Música y sonidos `/audio` | Parcial | Subir audio con licencia: probado. Generar con IA y bancos CC: requieren clave/Freesound → bloqueado |
| Biblioteca `/library` | Operativo | Probado (subida resumable, URL firmada, borrado, aislamiento entre usuarios) |
| Almacenamiento `/storage` | Operativo (solo lectura) | Probado; el botón «Actualizar» no muestra aviso visible al repetir (mejora menor) |
| Editar con mi estilo | Carga | Lógica determinista sin IA; flujo completo sin ejecutar con datos |
| Plantillas de montaje | Carga | Idem |
| Montaje automático | Carga | Idem (análisis en el navegador) |
| Workflows `/workflows` | Operativo | Carga; los filtros con 0 proyectos no cambian nada (esperado) |
| Calendario | Carga | Lee publicaciones; sin ejecutar con datos |
| Conectores | Operativo | Carga; con el permiso propuesto lee el estado de conexión |
| Costes y créditos `/usage` | Carga | Depende del catálogo de proveedores |
| Estudio de creación `/studio` | Bloqueado | Requiere claves de pago (solo Gemini TTS verificado con clave real, según el propio módulo) |
| Miniaturas | Bloqueado/parcial | La composición de texto es local; las variantes exigen proveedor de imagen |
| Shorts / Reels (`/repurpose`) | Carga | Propuesta de momentos por transcripción, sin IA; exige vídeo transcrito (transcripción = servicio externo) |
| Shorts diarios `/shorts` | Bloqueado | Exige Gemini + Cloudflare + Radar |
| Investigación | Bloqueado | 503 claro sin `YOUTUBE_API_KEY` (probado, sin fugas de secretos) |
| Radar | Bloqueado | Idem |
| Oportunidades | Carga | Actualizar métricas exige clave de YouTube |
| Automatizaciones | Bloqueado | Vigilancia exige clave de YouTube; el cron no existe en la beta |
| YouTube `/youtube` | Bloqueado | Exige OAuth de Google (credenciales) |
| Analytics | Bloqueado | Exige canal conectado |
| Instagram y TikTok `/social` | Bloqueado | Exige apps OAuth y auditoría de TikTok |
| Campañas | Carga | Constructor sin integraciones; sin probar de principio a fin |
| Virtual Influencer `/influencer` | Bloqueado | Modelos NOT_CONNECTED; generación bloqueada a 0 € por diseño |
| Añadir materiales `/add` | Parcial | Subida desde dispositivo operativa; Google Drive y Atajo de iOS exigen identificadores/credenciales |

Resumen: 9 operativos con evidencia de principio a fin, 8 «carga» (flujo sin ejecutar con datos: candidatos a la siguiente ronda de pruebas locales), 12 bloqueados o parciales por un servicio externo o clave (ninguno falla por un defecto propio detectado).

## Mejoras ejecutadas en esta etapa
Permisos de `channel_connections` (propuesta A por columnas, 16/16, no aplicada a Production); desbordamientos móviles de `/add` y `/editor/style` + regresión a 375/390 px en los 30 módulos; callejones sin salida de la beta; mensaje y prueba sin clave de YouTube; sonda interactiva de botones.

## Tres alternativas de infraestructura (coste 0 €)
Hechos verificados: la organización es plan Free con 2 proyectos activos (Cerebro Studio, gamemur) y 1 pausado; el límite Free de Supabase es global por propietario/administrador (según ChatGPT con documentación oficial; no verificado por mí). Lo demás son hipótesis sin comprobar contra condiciones vigentes.
1. **Stack oficial de Supabase autoalojado** (mismo `supabase-js`, cero cambios de código; validado 51/51 en local con ~500 MB de RAM) en una VM gratuita. Requiere una cuenta externa (p. ej. nivel gratuito permanente de un proveedor de nube, que suele pedir verificación con tarjeta): necesita autorización específica. Es la que menos código toca.
2. **Beta local expuesta con un túnel gratuito** desde una máquina con Linux/WSL y ≥2 GB libres (el PC de Jesús tiene 3,6 GB y no tiene WSL2: justo). Sin cuentas de pago; exposición controlada por la lista de testers.
3. **Liberar un cupo Free**: decisión de Jesús (pausar gamemur o pasar un proyecto a plan de pago). Cero cambios de código, pero afecta a otro proyecto: descartada salvo decisión suya.
No recomendadas por coste de migración: Appwrite, PocketBase, Neon+Auth propio (reescritura de Auth, Storage y RLS).
