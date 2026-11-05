import { NextResponse } from 'next/server'
import { fixturePng, FIXTURE_COLORS, stockFixtureOn } from '@/lib/providers/stock-fixture'

export const dynamic = 'force-dynamic'

/** Solid-colour test images for local tests. 404 unless CEREBRO_STOCK_FIXTURE=1 (and never in the private beta). */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  const id = name.replace(/\.png$/, '')
  if (!stockFixtureOn() || !(id in FIXTURE_COLORS)) return new NextResponse('Not found', { status: 404 })
  return new NextResponse(new Uint8Array(fixturePng(id)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
}
