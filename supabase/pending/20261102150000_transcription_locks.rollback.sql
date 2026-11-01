drop function if exists public.release_transcription_lock(text, text);
drop function if exists public.acquire_transcription_lock(text, text, int);
drop table if exists public.transcription_locks;
