# Informe P5.11 — Vídeo importado, seguridad y subtítulos

Rama `beta-privada`, coste 0 €, sin push ni cambios remotos.

## 1. Flujo real con vídeo (M30–M32)
- Fixture de prueba (solo con `CEREBRO_STOCK_FIXTURE=1`, nunca en beta privada): clip sintético azul de 6 s con tono de 330 Hz, etiquetado «[PRUEBA]».
- Desde la interfaz: importar a Biblioteca → asignar a plantilla → abrir en el Editor → recortar/dividir → añadir audio local → exportar MP4.
- Resultado verificado con FFprobe y decodificación real: MP4 de 10,03 s, h264 854x480 + aac, volumen medio −24,6 dB; fotogramas azul (vídeo) y verde (imagen) en la misma composición. No se sustituye el clip por una imagen fija.
- Cerrar sesión y volver a entrar recupera proyecto y resultado.

## 2. Auditoría de seguridad (M33)
- Barrido de 64 rutas API sin sesión: ningún 5xx ni filtración (los 503 «no configurado» de cron/automations/ios son esperados).
- 4 rutas abiertas en la beta con pruebas A/B entre usuarios: signed-url, storage/usage, storage/upload-url y providers/status; lectura, modificación, borrado, importación y exportación cruzadas rechazadas.
- **Vulnerabilidad encontrada:** las políticas RLS `owner_all` solo comprueban `owner_id = auth.uid()`, así que un usuario podía insertar filas propias apuntando al `project_id` de otro. **Corrección propuesta (no aplicada en remoto):** `supabase/proposed/20261105130000_project_ownership_check.sql` (+ rollback), validada 12/12 en Postgres desechable y 39/39 E2E en el stack oficial; incluida en `supabase/beta/schema-beta.sql`.
- **Endurecimiento local:** importaciones concurrentes idempotentes (bloqueo en proceso + espera al ganador + reconciliación tras insertar). Prueba: 6 simultáneas → 1 sola fila.
- Observación menor: los mensajes 503 sin sesión nombran variables de entorno (ruta cron cerrada en beta).

## 3. Subtítulos sin IA (M34)
- Pegar transcripción sin tiempos → reparto **ESTIMADO** por longitud, con aviso visible («No son tiempos detectados») y totalmente editable.
- Importar SRT/VTT con tiempos reales: se respetan y no se marcan como estimados. Un subtítulo que cruza el límite entre clips se parte en dos fragmentos.
- Editar texto y tiempos (el fin se limita a la duración del clip), guardar y recuperar tras recargar.
- Exportar SRT con los cambios; grabar subtítulos en el MP4 al activar la opción: 825 píxeles de texto blanco en la franja inferior frente a 0 en el MP4 sin ellos.

## 4. Validación
- TypeScript 0 errores; ESLint 0 errores; Vitest 1653 correctas (22 omitidas); `test:proposals` 12/12.
- E2E de módulos en stack Supabase oficial local: 39/39.
- Chromium principal: 686/686.
- Exportación en tiempo real sigue desactivada.

## 5. Limitaciones pendientes
- La política de propiedad de proyecto y el GRANT de `channel_connections` requieren autorización de Jesús para aplicarse en remoto.
- Los subtítulos no se detectan automáticamente (próximo estudio: transcripción local ligera).
- Pexels/YouTube siguen apagados sin claves; despliegue público bloqueado hasta tener infraestructura gratuita aislada.
