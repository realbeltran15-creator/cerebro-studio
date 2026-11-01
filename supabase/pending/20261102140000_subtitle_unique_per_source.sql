-- PROPUESTA (NO APLICADA, SIN PROBAR): un único subtítulo por audio/vídeo de origen.
-- Antes de aplicar: comprobar duplicados existentes (consulta al final) y resolverlos a mano.
create unique index if not exists assets_subtitle_one_per_source
  on public.assets (owner_id, (provenance->>'sourceAssetId'))
  where asset_type = 'subtitle' and provenance ? 'sourceAssetId';

-- Duplicados actuales (debe devolver 0 filas antes de aplicar):
-- select owner_id, provenance->>'sourceAssetId' as src, count(*) from public.assets
--  where asset_type='subtitle' and provenance ? 'sourceAssetId' group by 1,2 having count(*)>1;
