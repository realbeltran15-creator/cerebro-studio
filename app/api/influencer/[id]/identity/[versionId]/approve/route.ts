import { approveIdentityVersion, ViError } from '@/lib/virtual-influencer/server'
import { withUser } from '@/lib/virtual-influencer/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params
  const body = await request.json().catch(() => ({})) as { confirm?: string }
  return withUser(async ({ db, userId }) => {
    if (body.confirm !== 'APROBAR') throw new ViError('Falta la confirmación explícita.')
    return approveIdentityVersion(db, userId, id, versionId)
  })
}
