# P2 — Seguridad económica, distribución y automatización (local, 0 €, solo lectura de lo existente)

Ninguna llamada real a APIs de publicación, proveedores de pago, OAuth ni cron. Todo con dobles o análisis estático.

| Módulo | Estado real | Defectos hallados → corrección | Pruebas (R=real, S=simulado, E=estático) | Puntuación interna* |
|---|---|---|---|---|
| P2.1 Costes y créditos | Confirmación de coste obligatoria, tope diario/mensual, libro de gasto del servidor, pantalla que separa «estimado» de «real informado» | La comprobación del tope y el registro del gasto eran pasos separados: N peticiones simultáneas podían pasar todas → reserva en memoria por usuario (una instancia) tomada sin `await` tras la comprobación y la comprobación movida junto al registro. **Limitación:** entre instancias solo lo cierra la reserva atómica en BD (SQL propuesto, no aplicado, sin probar) | S: 10 peticiones, tope 1 USD, 0,4 USD cada una → pasan 2; caducidad, liberación, aislamiento | 88 |
| P2.1 Conectores / OAuth | Refresco del token, `invalid_grant` → `expired` sin enviar nada, revocación, cifrado, llamada de cron con comparación en tiempo constante | Sin defectos. Añadidos tests estáticos: ningún componente de cliente lee variables privadas ni importa módulos de servidor; ningún log escribe tokens/claves | E: 3 tests sobre todo `app/` y `lib/` | 90 |
| P2.2 YouTube | Aprobación explícita sellada, canal confirmado, reclamo atómico, recuperación sin resubir, verificación posterior | Sin defectos | Tests existentes (S) | 91 |
| P2.2 Instagram/TikTok | Misma estructura | **Un vídeo guardado como incompleto podía aprobarse y publicarse** (YouTube sí lo bloqueaba) → bloqueo en aprobación (YouTube y social) y en publicación social | E+R: helper y presencia en los 4 puntos | 88 |
| P2.3 Calendario / Campañas | Las fechas son recordatorios; solo borradores admiten fecha; nada se publica solo | Una fecha inexistente hacía lanzar `toISOString()` → `plannedIso` validado (acepta 29-feb solo bisiesto) | R: validez, mismo día de ida y vuelta en cambios de hora (Madrid, México, Auckland, UTC), cuadrícula de 42 días | 89 |
| P2.4 Analytics | Separa `observed` y `calculated`, fecha de importación, rango pedido | Una sola consulta (límite 400) mezclaba filas diarias y por vídeo: con varias importaciones las filas de vídeo desplazaban a las diarias y salían menos días → dos consultas separadas | Sin test automático de la pantalla (cambio de consulta); no se consultó ninguna API | 85 |
| P2.5 Automatizaciones | Cron con secreto en tiempo constante, 503 si falta configuración, ventana de 20 h, máx. 25, un solo «running» por automatización (índice único), cierre de ejecuciones huérfanas a los 15 min | Sin defectos. No se activó ni modificó nada | Tests existentes (S) | 90 |
| Estados comunes | Cada módulo tenía su vocabulario | Nuevo `lib/operation-state.ts`: Preparado / Pendiente de aprobación / En ejecución / Completado y verificado + Fallido / Cancelado / Incierto; «publicado» sin evidencia = incierto. **Aún no está conectado a las pantallas** | R: 4 tests | — |

*Puntuación interna orientativa, no medida por usuarios.

Validación: tsc limpio; 152 ficheros / 1476 tests OK (13 omitidos); next build OK. Coste 0 €. Sin push, sin migraciones aplicadas.
Pendiente: reserva atómica en BD (migración), conectar `operation-state` a las pantallas, pruebas en navegador y contra Supabase real.
