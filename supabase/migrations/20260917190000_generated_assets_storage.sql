insert into storage.buckets (id, name, public)
values ('generated-assets', 'generated-assets', false)
on conflict (id) do update set public = false;

create policy "generated assets select own"
on storage.objects for select
to authenticated
using (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "generated assets insert own"
on storage.objects for insert
to authenticated
with check (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "generated assets update own"
on storage.objects for update
to authenticated
using (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "generated assets delete own"
on storage.objects for delete
to authenticated
using (bucket_id = 'generated-assets' and (storage.foldername(name))[1] = auth.uid()::text);
