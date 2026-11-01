import { runQueueRoute } from '@/lib/queue/server'
export const dynamic = 'force-dynamic'
export const GET = async (request: Request, ctx: { params: Promise<{ id: string }> }) => runQueueRoute(request, 'get', (await ctx.params).id)
