# P4.1 — Preparación de integración Supabase y bloqueantes beta
Presupuesto 0 €. Sin ramas/proyectos creados. Sin cambios en Production.

## 1. Rama Supabase de pruebas: evaluación (solo lectura + documentación oficial)
- Ramas existentes: ninguna (`list_branches` → vacío). Plan de la organización: **no verificable** desde aquí (permiso denegado a `get_organization`).
- Documentación oficial: las ramas Preview requieren plan **Pro**; cada rama es un entorno separado con Database, Auth, Storage…, con el esquema pero sin datos de Production; se cobra por uso (Micro desde 0,01344 USD/h + disco + egress) y **no está cubierta por el Spend Cap**; los Compute Credits no se aplican a ramas.
- Conclusión: **no se puede demostrar coste cero** (plan desconocido, cargos por hora sin tope). Aislamiento y capacidad (Auth, PostgREST, Storage, RLS, migraciones reversibles) son adecuados SI el plan es Pro. **Bloqueado a la espera de decisión explícita de Jesús**; entre tanto se usan pruebas locales.

## 2. Alternativa de 0 € ejecutada: PostgREST REAL local
Docker está instalado pero sin demonio, así que no hay stack Supabase completo. Sí se ejecutó el binario oficial PostgREST 12.2.3 contra el PostgreSQL local, con el cliente real `@supabase/postgrest-js` (el de supabase-js para `.from()`/`.rpc()`): `scripts/test-postgrest-integration.sh` + `scripts/postgrest-integration.mjs` → **29 ejecutadas · 29 pasan · 0 fallan**. Los JWT los firma el propio test: **no es Supabase Auth**.

## 3. Matriz de dependencias
| Prueba | PostgreSQL | PostgREST | Supabase Auth | Storage | Navegador autenticado | OAuth externo | Estado |
|---|---|---|---|---|---|---|---|
| RLS y aislamiento entre usuarios | sí | sí | JWT simulado | no | no | no | Validado local (PG + PostgREST reales; Auth NO) |
| Guardado/concurrencia de guiones (versión única) | sí | sí | simulado | no | no | no | Validado local |
| Storyboard idempotente | sí | sí | simulado | no | no | no | Validado local |
| Reorden y borrado de escenas | sí | sí | simulado | no | no | no | Validado local |
| Reserva económica atómica | sí | sí (service_role) | simulado | no | no | no | Validado local |
| Locks de transcripción | sí | no expuesto | no | no | no | no | Validado en PG; el worker no existe aún |
| Subtítulo único por origen | sí | sí | simulado | no | no | no | Validado local |
| Login/registro/refresh de sesión | no | no | **real** | no | sí | no | **No probado** |
| Subida/descarga/borrado de materiales | no | no | real | **real** | sí | no | **No probado** (política de buckets sin verificar) |
| Persistencia de montajes/exportaciones | parcial | parcial | real | real | sí | no | Parcial (solo simulado en navegador) |
| Recuperación de Biblioteca | sí | sí | real | real | sí | no | **No probado** con Storage real |
| Google OAuth / YouTube | no | no | real | no | sí | **real** | **No probado**; prohibido sin autorización |

## 4. Criterios de seguridad respetados
Datos sintéticos (UUID aleatorios), sin claves/tokens de Production, sin generación de pago ni publicación, sin tocar cron/workers/automatizaciones, todo reversible (bases y procesos temporales destruidos al salir).

## 5. Bloqueantes beta provisionales
- P0: ninguno conocido en código.
- P1 (requieren a Jesús): decidir rama Supabase (coste); OAuth Google en Production + reconectar YouTube; recorrido manual con sesión real (`docs/guion-prueba-manual-recorrido.md`); autorizar push/migraciones.
- P2: riesgo realtime vs vista previa; WebM/MP4 local sin cubrir; SQL pendiente sin validar en Supabase real (Auth/Storage); Instagram/TikTok sin pruebas funcionales.
