import { NextResponse } from 'next/server'
import { publicProviderState } from '@/lib/providers/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ providers: publicProviderState() }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
