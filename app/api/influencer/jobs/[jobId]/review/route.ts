import { reviewJob, ViError } from '@/lib/virtual-influencer/server'
import { withUser } from '@/lib/virtual-influencer/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const body = await request.json().catch(() => ({})) as { decision?: string; note?: string; confirm?: string }
  return withUser(async ({ db, userId }) => {
    if (body.decision !== 'approved' && body.decision !== 'rejected') throw new ViError('Decisión no válida.')
    if (body.decision === 'approved' && body.confirm !== 'APROBAR') throw new ViError('Falta la confirmación explícita.')
    return reviewJob(db, userId, jobId, body.decision, body.note ?? null)
  })
}
