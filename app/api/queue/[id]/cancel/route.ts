import { runQueueRoute } from '@/lib/queue/server'
export const dynamic = 'force-dynamic'
export const POST = async (request: Request, ctx: { params: Promise<{ id: string }> }) => runQueueRoute(request, 'cancel', (await ctx.params).id)
