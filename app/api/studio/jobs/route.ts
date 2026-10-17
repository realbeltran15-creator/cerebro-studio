import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { listJobs } from '@/lib/providers/job-ledger'

export const dynamic = 'force-dynamic'

/** Queued generations recorded on the server for this owner (pending first), so any page or device can resume them. */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const jobs = await listJobs(supabase, user.id)
    return NextResponse.json({ jobs: jobs.map(({ token, ...j }) => ({ ...j, token: j.state === 'pending' ? token : undefined })) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se pudieron leer los trabajos.' }, { status: 500 })
  }
}
