-- PROPUESTA (NO aplicada a Production). Problema: Production hizo `revoke all on public.channel_connections from authenticated`,
-- por lo que los módulos que leen el estado de conexión desde el navegador (Inicio, YouTube, Redes, Analytics, Conectores, Shorts) reciben 403.
-- Solución elegida: permiso SELECT por COLUMNAS, solo las seguras. token_ciphertext y token_metadata siguen sin permiso.
-- La política RLS channel_connections_owner_read (owner_id = auth.uid()) ya existe y sigue acotando las filas al propietario.
-- Escritura: sigue sin permisos para authenticated (solo el servidor con la clave de servicio).
grant select (id, provider, external_account_id, external_account_name, scopes, status, created_at, updated_at)
  on public.channel_connections to authenticated;
