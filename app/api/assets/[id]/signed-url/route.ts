import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { signedReadUrl } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: asset } = await supabase.from('assets').select('id,owner_id,storage_path').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!asset?.storage_path) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  // The editor streams long videos from this URL while it plays, so it may ask for a longer life (at most 4 h; default 5 min).
  const asked = Number(new URL(request.url).searchParams.get('ttl'))
  const ttl = Number.isFinite(asked) && asked >= 60 ? Math.min(Math.round(asked), 14_400) : 300
  try {
    return NextResponse.json({ url: await signedReadUrl(supabase, user.id, asset.storage_path, ttl), expiresIn: ttl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Could not create asset access URL' }, { status: 503 })
  }
}
