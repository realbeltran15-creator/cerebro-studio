import { runQueueRoute } from '@/lib/queue/server'
export const dynamic = 'force-dynamic'
/** POST: encola un trabajo (siempre dry_run). Desactivado por defecto (404). */
export const POST = (request: Request) => runQueueRoute(request, 'enqueue')
