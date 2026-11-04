revoke select (id, provider, external_account_id, external_account_name, scopes, status, created_at, updated_at)
  on public.channel_connections from authenticated;
