import { createJob, ViError, type JobRequest } from '@/lib/virtual-influencer/server'
import { withUser } from '@/lib/virtual-influencer/http'

export const dynamic = 'force-dynamic'

/** Creates a generation job after server-side preflight. Never spends: blocked jobs record their reasons. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null) as Partial<JobRequest> | null
  return withUser(async ({ db, userId }) => {
    if (!body?.kind || !body.adapterId) throw new ViError('Faltan el tipo y el proveedor.')
    return createJob(db, userId, id, { kind: body.kind, adapterId: body.adapterId, prompt: String(body.prompt ?? ''), inputs: body.inputs ?? {}, estimatedCostEur: body.estimatedCostEur ?? null })
  })
}
