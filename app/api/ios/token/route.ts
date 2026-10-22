import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { hashToken, newToken, SHORTCUT_KEY, type ShortcutConfig } from '@/lib/ingest/shortcut'

export const dynamic = 'force-dynamic'

/** The owner's iPhone shortcut token: status (GET), create/regenerate (POST, the plain token is returned once), destination (PATCH), revoke (DELETE). */
async function ctx() {
  const db = await createServerSupabaseClient()
  const { data: { user } } = await db.auth.getUser()
  return { db, user }
}
async function current(db: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const { data } = await db.from('connector_configs').select('id,config').eq('provider', SHORTCUT_KEY.provider).eq('capability', SHORTCUT_KEY.capability).maybeSingle()
  return data as { id: string; config: ShortcutConfig } | null
}
async function validDestination(db: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string, d: unknown) {
  if (d === 'library' || d === undefined || d === null) return 'library'
  if (typeof d !== 'string' || !/^[0-9a-f-]{36}$/i.test(d)) return null
  const { data } = await db.from('projects').select('id').eq('id', d).eq('owner_id', userId).maybeSingle()
  return data ? d : null
}

export async function GET() {
  const { db, user } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await current(db)
  return NextResponse.json({ active: Boolean(row?.config?.hash), createdAt: row?.config?.createdAt ?? null, destination: row?.config?.destination ?? 'library', lastUsedAt: row?.config?.lastUsedAt ?? null, uploads: row?.config?.uploads ?? 0, serverReady: Boolean(serviceRoleClient()) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const { db, user } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { destination?: string }
  const destination = await validDestination(db, user.id, body.destination)
  if (!destination) return NextResponse.json({ error: 'Destino no válido.' }, { status: 400 })
  const token = newToken()
  const config: ShortcutConfig = { hash: hashToken(token), createdAt: new Date().toISOString(), destination, lastUsedAt: null, uploads: 0 }
  const row = await current(db)
  const { error } = row
    ? await db.from('connector_configs').update({ config, enabled: true, updated_at: new Date().toISOString() }).eq('id', row.id)
    : await db.from('connector_configs').insert({ owner_id: user.id, ...SHORTCUT_KEY, enabled: true, priority: 0, config, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Shown once: only its hash is stored.
  return NextResponse.json({ token, destination }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request) {
  const { db, user } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await current(db)
  if (!row) return NextResponse.json({ error: 'Primero crea el código del atajo.' }, { status: 404 })
  const destination = await validDestination(db, user.id, ((await request.json().catch(() => ({}))) as { destination?: string }).destination)
  if (!destination) return NextResponse.json({ error: 'Destino no válido.' }, { status: 400 })
  const { error } = await db.from('connector_configs').update({ config: { ...row.config, destination }, updated_at: new Date().toISOString() }).eq('id', row.id)
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ destination })
}

export async function DELETE() {
  const { db, user } = await ctx()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { error } = await db.from('connector_configs').delete().eq('provider', SHORTCUT_KEY.provider).eq('capability', SHORTCUT_KEY.capability).eq('owner_id', user.id)
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ revoked: true })
}
