drop function if exists public.reorder_scenes(uuid, uuid[]);
drop trigger if exists scenes_touch_updated_at on public.scenes;
drop function if exists public.touch_scene_updated_at();
alter table public.scenes drop column if exists updated_at;
