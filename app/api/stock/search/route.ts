import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { searchStock, stockConfigured, stockKinds, type StockKind, type StockSource } from '@/lib/providers/stock'

export const dynamic = 'force-dynamic'

const sources: StockSource[] = ['freesound', 'pexels', 'pixabay']

/** Searches a free media bank. GET without q returns which banks are configured. */
export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = new URL(request.url)
  const source = sources.find(s => s === u.searchParams.get('source'))
  const kind = u.searchParams.get('kind') as StockKind | null
  const q = u.searchParams.get('q') ?? ''
  if (!source) return NextResponse.json({ sources: sources.map(s => ({ id: s, configured: stockConfigured(s), kinds: stockKinds[s] })) })
  if (!kind || !stockKinds[source].includes(kind)) return NextResponse.json({ error: 'Tipo no disponible en ese banco.' }, { status: 400 })
  try {
    const items = await searchStock(source, kind, q, {
      orientation: u.searchParams.get('orientation') ?? undefined,
      maxSeconds: Number(u.searchParams.get('maxSeconds')) || undefined,
      cc0Only: u.searchParams.get('cc0') === '1',
    })
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Búsqueda no disponible.' }, { status: 502 })
  }
}
