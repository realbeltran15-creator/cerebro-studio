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

// Lazy handle: pages call this during render, which also runs at build-time
// prerender where the public env vars may be absent. The real client is only
// created on first use (effects and handlers), so a missing config fails there.
let lazyClient: ReturnType<typeof createBrowserClient> | undefined

export function getSupabaseBrowserClient() {
  if (!lazyClient) {
    lazyClient = new Proxy({} as ReturnType<typeof createBrowserClient>, {
      get(_target, prop) {
        if (!browserClient) browserClient = createClient()
        const value = Reflect.get(browserClient, prop, browserClient)
        return typeof value === 'function' ? value.bind(browserClient) : value
      },
    })
  }
  return lazyClient
}
