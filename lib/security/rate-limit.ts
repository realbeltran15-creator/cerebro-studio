import { NextResponse } from 'next/server'

/**
 * Best-effort request limiter for routes that can spend money or provider quota (generation, transcription, text assistance).
 * Sliding window per user and route, kept in the memory of the serverless instance: it stops runaway loops, double-click storms and scripts
 * against one instance, but it is not a global guarantee (another instance has its own window). The money guard is the server-side spending
 * cap (lib/providers/spend.ts); this only limits the request rate.
 */
const windows = new Map<string, number[]>()

export type RateRule = { limit: number; windowMs: number }
export const RATE_RULES = {
  generate: { limit: 20, windowMs: 60_000 },
  transcribe: { limit: 10, windowMs: 60_000 },
  textAssist: { limit: 20, windowMs: 60_000 },
  recreate: { limit: 6, windowMs: 60_000 },
} satisfies Record<string, RateRule>

export function hit(key: string, rule: RateRule, now = Date.now()): { allowed: boolean; retryAfterS: number } {
  const recent = (windows.get(key) ?? []).filter(t => now - t < rule.windowMs)
  if (recent.length >= rule.limit) {
    windows.set(key, recent)
    return { allowed: false, retryAfterS: Math.max(1, Math.ceil((rule.windowMs - (now - recent[0])) / 1000)) }
  }
  recent.push(now); windows.set(key, recent)
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.some(t => now - t < 3_600_000)) windows.delete(k)
  return { allowed: true, retryAfterS: 0 }
}

/** null when allowed; otherwise a 429 response to return from the route. */
export function rateLimited(userId: string, route: keyof typeof RATE_RULES): NextResponse | null {
  const r = hit(`${route}:${userId}`, RATE_RULES[route])
  return r.allowed ? null : NextResponse.json({ error: `Demasiadas solicitudes seguidas. Espera ${r.retryAfterS} s; no se ha enviado nada.` }, { status: 429, headers: { 'Retry-After': String(r.retryAfterS) } })
}

export const _resetRateLimits = () => windows.clear()
