import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ownerOfPath, removeObject } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

/** Deletes one of the caller's stored files (used to roll back a failed upload or delete an asset). */
export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { storagePath } = await request.json().catch(() => ({})) as { storagePath?: string }
  if (!storagePath || ownerOfPath(storagePath) !== user.id || storagePath.includes('..')) return NextResponse.json({ error: 'Archivo no válido.' }, { status: 403 })
  try { await removeObject(supabase, user.id, storagePath) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo borrar.' }, { status: 502 }) }
  return NextResponse.json({ deleted: true })
}
