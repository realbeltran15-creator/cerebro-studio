import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { storageDriver, SUPABASE_MAX_BYTES } from '@/lib/storage/server'

export const dynamic = 'force-dynamic'

/**
 * Cloud space used by the owner's files (from each asset's recorded size), by kind, against the same quota that uploads enforce.
 * Read-only: nothing is listed from storage and no file is touched.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const driver = storageDriver()
  const quotaBytes = Math.max(0.1, Number(process.env.STORAGE_QUOTA_GB) || (driver === 'r2' ? 9 : 0.95)) * 1024 ** 3
  const { data, error } = await supabase.from('assets').select('asset_type,source_provider,bytes:provenance->bytes').eq('owner_id', user.id).limit(20000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const byKind: Record<string, { files: number; bytes: number }> = {}
  let used = 0
  for (const r of (data ?? []) as Array<{ asset_type: string; source_provider: string | null; bytes?: unknown }>) {
    const b = Number(r.bytes) || 0
    const k = r.source_provider === 'browser-render' || r.source_provider === 'browser-convert' ? 'export' : r.asset_type
    byKind[k] = { files: (byKind[k]?.files ?? 0) + 1, bytes: (byKind[k]?.bytes ?? 0) + b }
    used += b
  }
  return NextResponse.json({ driver, usedBytes: used, quotaBytes, maxFileBytes: driver === 'r2' ? null : SUPABASE_MAX_BYTES, byKind }, { headers: { 'Cache-Control': 'no-store' } })
}
