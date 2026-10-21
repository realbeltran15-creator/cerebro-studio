import { NextResponse } from 'next/server'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { confirmationCode, parseSignedRequest } from '@/lib/oauth/meta-signed-request'

export const dynamic = 'force-dynamic'

/**
 * Meta «Data Deletion Request» and «Deauthorize» callback for the Instagram app. Meta posts a signed_request when a person removes
 * the app or asks for their data to be deleted: the signature is checked with INSTAGRAM_APP_SECRET and only the credentials of that
 * Instagram account are deleted (status «revoked», token removed). Replies with the status URL and confirmation code Meta expects.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const signed = String(form?.get('signed_request') ?? '')
  const data = parseSignedRequest(signed, process.env.INSTAGRAM_APP_SECRET?.trim() ?? '')
  if (!data?.user_id) return NextResponse.json({ error: 'invalid signed_request' }, { status: 400 })
  const db = serviceRoleClient()
  if (db) {
    const now = new Date().toISOString()
    // Instagram may send either the professional account ID (stored as external_account_id) or the app-scoped ID (token_metadata).
    await db.from('channel_connections').update({ status: 'revoked', token_ciphertext: null, updated_at: now }).eq('provider', 'instagram').eq('external_account_id', data.user_id)
    await db.from('channel_connections').update({ status: 'revoked', token_ciphertext: null, updated_at: now }).eq('provider', 'instagram').eq('token_metadata->>app_scoped_id', data.user_id)
  }
  const code = confirmationCode()
  return NextResponse.json({ url: `${new URL(request.url).origin}/legal/eliminar-datos?code=${code}`, confirmation_code: code })
}
