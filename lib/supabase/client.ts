import { createBrowserClient } from '@supabase/ssr'

let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error('Faltan las variables públicas de Supabase')
  }

  return createBrowserClient(url, key)
}

export function getSupabaseBrowserClient() {
  if (!browserClient) browserClient = createClient()
  return browserClient
}
