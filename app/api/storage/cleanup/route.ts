import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { cleanupDelete, cleanupReport } from '@/lib/storage/cleanup'
import { r2Configured } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

/**
 * R2 clean-up for the signed-in person's own folder.
 *   { action: 'report' }                        → files nothing refers to (older than a day) and abandoned uploads (older than 7 days). Changes nothing.
 *   { action: 'delete', keys?, uploads? }       → removes only what a fresh report lists, and only if `confirm` is true.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!r2Configured()) return NextResponse.json({ error: 'Cloudflare R2 no está configurado.' }, { status: 409 })
  const b = await request.json().catch(() => ({})) as { action?: string; confirm?: boolean; keys?: unknown; uploads?: unknown }
  try {
    if (b.action === 'report') return NextResponse.json(await cleanupReport(supabase, user.id), { headers: { 'Cache-Control': 'no-store' } })
    if (b.action === 'delete') {
      if (b.confirm !== true) return NextResponse.json({ error: 'Falta la confirmación.' }, { status: 400 })
      const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === 'string').slice(0, 500) : []
      const uploads = Array.isArray(b.uploads) ? b.uploads.flatMap(u => (u && typeof (u as { key?: unknown }).key === 'string' && typeof (u as { uploadId?: unknown }).uploadId === 'string' ? [{ key: (u as { key: string }).key, uploadId: (u as { uploadId: string }).uploadId }] : [])).slice(0, 500) : []
      return NextResponse.json(await cleanupDelete(supabase, user.id, { keys, uploads }), { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo limpiar.' }, { status: 502 })
  }
}
