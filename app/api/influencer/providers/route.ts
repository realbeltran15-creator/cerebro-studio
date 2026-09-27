import { adapterReport } from '@/lib/virtual-influencer/providers'
import { withUser } from '@/lib/virtual-influencer/http'

export const dynamic = 'force-dynamic'

/** Adapter status from the server environment. Returns names of missing variables, never values. */
export async function GET() {
  return withUser(async () => ({ adapters: adapterReport() }))
}
