/** Fabrica de dependencias para las rutas. Devuelve null (=> 404) salvo que la configuracion de pruebas lo active explicitamente. */
import { NextResponse } from 'next/server'
import { hit, type RateRule } from '@/lib/security/rate-limit'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { handleQueueRequest, type ApiRequest } from './api'
import { resolveQueueConfig } from './config'
import { createRpcStore } from './rpc-adapter'

const RULE: RateRule = { limit: 30, windowMs: 60_000 }

export async function runQueueRoute(request: Request, action: ApiRequest['action'], jobId?: string): Promise<NextResponse> {
  const config = resolveQueueConfig(process.env)
  if (!config.enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = serviceRoleClient()
  if (!admin) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const store = createRpcStore(async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data
  })
  const body = request.method === 'POST' ? await request.json().catch(() => null) : undefined
  const res = await handleQueueRequest(
    { action, method: request.method, origin: request.headers.get('origin'), host: request.headers.get('host'), user: user ? { id: user.id } : null, body, jobId },
    { config, store, rateLimit: (id, key) => hit(`${key}:${id}`, RULE) },
  )
  return NextResponse.json(res.body, { status: res.status, headers: res.headers })
}
