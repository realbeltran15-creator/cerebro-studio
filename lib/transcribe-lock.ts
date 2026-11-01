/** Bloqueo con caducidad compartido entre instancias (puerto). La implementación real usaría una tabla con clave única (ver supabase/pending). */
export interface LockStore {
  /** Atómico: devuelve true solo si la clave no existe o ya caducó. */
  tryAcquire(key: string, owner: string, ttlMs: number, now: number): Promise<boolean>
  release(key: string, owner: string): Promise<void>
}

export async function withLock<T>(store: LockStore, key: string, owner: string, fn: () => Promise<T>, o: { ttlMs?: number; now?: () => number } = {}): Promise<{ busy: true } | { busy: false; value: T }> {
  const now = o.now ?? Date.now
  if (!(await store.tryAcquire(key, owner, o.ttlMs ?? 6 * 60_000, now()))) return { busy: true }
  try { return { busy: false, value: await fn() } } finally { await store.release(key, owner).catch(() => undefined) }
}

/** Doble en memoria con la misma semántica atómica que la tabla (para tests locales). */
export function memoryLockStore(): LockStore & { size(): number } {
  const m = new Map<string, { owner: string; until: number }>()
  return {
    async tryAcquire(key, owner, ttlMs, now) { const cur = m.get(key); if (cur && cur.until > now) return false; m.set(key, { owner, until: now + ttlMs }); return true },
    async release(key, owner) { if (m.get(key)?.owner === owner) m.delete(key) },
    size: () => m.size,
  }
}
