import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { openGuardedStore, quotaErrorResponse } from '@/lib/research/guard'
import { quotaLimits, readUsage } from '@/lib/research/quota'
import { quotaDayKey } from '@/lib/research/cache'

export const dynamic = 'force-dynamic'

/**
 * What THIS application has spent today, against both daily limits (quota units and search.list calls). Free: no YouTube call.
 * `verified` is always false: spending by other applications that share the Google Cloud project cannot be read from here, so the
 * figures are an estimate of the app's own consumption and «remaining» is not a promise that YouTube will still answer.
 */
export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const store = await openGuardedStore(supabase, user.id, request), limits = quotaLimits(), u = await readUsage(store, limits)
    return NextResponse.json({
      usedToday: u.units.used, cap: u.units.cap, remaining: Math.max(u.units.cap - u.units.used, 0), persistent: u.persistent,
      searchesToday: u.searches.used, searchCap: u.searches.cap, searchesRemaining: Math.max(u.searches.cap - u.searches.used, 0),
      exhausted: u.exhausted, verified: false, atomic: u.atomic, day: quotaDayKey(),
      official: limits.official, externalReserved: { units: limits.externalUnits, searches: limits.externalSearches },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return quotaErrorResponse(error) ?? NextResponse.json({ error: 'No se pudo leer el consumo de hoy.' }, { status: 500 })
  }
}
