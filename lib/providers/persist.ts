import type { GeneratedAsset, ProviderContext } from './types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function persistGeneratedAsset(
  context: ProviderContext,
  kind: 'image' | 'video' | 'voice' | 'render',
  asset: GeneratedAsset,
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== context.ownerId) throw new Error('Unauthorized provider asset persistence.')

  const { data, error } = await supabase.from('assets').insert({
    owner_id: user.id,
    project_id: context.projectId,
    kind,
    storage_path: asset.uri,
    metadata: {
      provider: asset.provider,
      externalId: asset.externalId ?? null,
      mimeType: asset.mimeType,
      requestId: context.requestId,
      ...(asset.metadata ?? {}),
    },
  }).select('id,owner_id,project_id,kind,storage_path,metadata,created_at').single()

  if (error) throw new Error(`Could not persist generated asset: ${error.message}`)
  return data
}
