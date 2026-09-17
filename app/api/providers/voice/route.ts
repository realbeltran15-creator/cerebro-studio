import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { HttpVoiceProvider } from '@/lib/providers/http-adapters'
import { persistGeneratedAsset } from '@/lib/providers/persist'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { projectId?: string; text?: string; voice?: string } | null
  const projectId=body?.projectId?.trim(), text=body?.text?.trim()
  if(!projectId||!text) return NextResponse.json({error:'projectId and text are required'},{status:400})
  const {data:project}=await supabase.from('projects').select('id').eq('id',projectId).eq('owner_id',user.id).maybeSingle()
  if(!project) return NextResponse.json({error:'Project not found'},{status:404})
  const requestId=crypto.randomUUID(), context={ownerId:user.id,projectId,requestId}
  try {
    const generated=await new HttpVoiceProvider().synthesize(context,text,body?.voice)
    const asset=await persistGeneratedAsset(context,'voice',generated)
    return NextResponse.json({requestId,asset},{status:201})
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Voice generation failed.',requestId},{status:503})}
}
