-- PROPUESTA (NO APLICADA, SIN PROBAR): bloqueo con caducidad entre instancias para transcripciones.
create table if not exists public.transcription_locks (
  key text primary key,
  owner text not null,
  expires_at timestamptz not null
);
alter table public.transcription_locks enable row level security;  -- sin políticas: solo service role / función

create or replace function public.acquire_transcription_lock(p_key text, p_owner text, p_ttl_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.transcription_locks(key, owner, expires_at) values (p_key, p_owner, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update set owner = excluded.owner, expires_at = excluded.expires_at
    where public.transcription_locks.expires_at <= now();
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.acquire_transcription_lock(text, text, int) from public, anon, authenticated;

create or replace function public.release_transcription_lock(p_key text, p_owner text) returns void
language sql security definer set search_path = public as $$ delete from public.transcription_locks where key = p_key and owner = p_owner $$;
revoke all on function public.release_transcription_lock(text, text) from public, anon, authenticated;
