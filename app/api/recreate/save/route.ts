import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sceneRows, storyboardRow } from '@/lib/recreate/build'
import { canonicalYouTubeUrl } from '@/lib/recreate/youtube-url'
import { validatePlan } from '@/lib/recreate/validate'

export const dynamic = 'force-dynamic'

/** Saves the (possibly edited) plan as a 9:16 storyboard with one scene per planned scene. Only after the user confirms. */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { projectId?: string; plan?: unknown; consistent?: boolean; source?: string } | null
  const projectId = body?.projectId?.trim()
  if (!projectId) return NextResponse.json({ error: 'projectId es obligatorio.' }, { status: 400 })
  const plan = validatePlan(body?.plan, body?.consistent === true)
  if (!plan) return NextResponse.json({ error: 'El plan no cumple las reglas (6-10 escenas de 2-5 s, 15-40 s en total, narración que cabe en cada escena).' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 })

  const { data: board, error: boardError } = await supabase.from('storyboards').insert(storyboardRow(user.id, projectId, plan)).select('id').single()
  if (boardError || !board) return NextResponse.json({ error: 'No se pudo crear el storyboard.' }, { status: 500 })
  const { data: scenes, error: sceneError } = await supabase.from('scenes').insert(sceneRows(user.id, board.id, plan, { url: body?.source ? canonicalYouTubeUrl(body.source) : null })).select('id,position').order('position')
  if (sceneError || !scenes) {
    await supabase.from('storyboards').delete().eq('id', board.id).eq('owner_id', user.id)
    return NextResponse.json({ error: 'No se pudieron crear las escenas.' }, { status: 500 })
  }
  return NextResponse.json({ storyboardId: board.id, scenes }, { status: 201 })
}
