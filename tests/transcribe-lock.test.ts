import { describe, expect, it } from 'vitest'
import { memoryLockStore, withLock } from '@/lib/transcribe-lock'

describe('withLock (multi-instancia, doble en memoria)', () => {
  it('de N intentos simultáneos solo uno ejecuta el trabajo', async () => {
    const store = memoryLockStore(); let runs = 0
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => withLock(store, 'asset:1', `inst-${i}`, async () => { runs++; await new Promise(r => setTimeout(r, 20)); return i })))
    expect(runs).toBe(1)
    expect(res.filter(r => r.busy)).toHaveLength(7)
    expect(store.size()).toBe(0)
  })
  it('un bloqueo caducado (instancia caída) se puede recuperar', async () => {
    const store = memoryLockStore(); let t = 0
    expect(await store.tryAcquire('k', 'muerta', 1000, t)).toBe(true)
    t = 500; expect((await withLock(store, 'k', 'otra', async () => 1, { now: () => t })).busy).toBe(true)
    t = 1500; expect(await withLock(store, 'k', 'otra', async () => 2, { now: () => t })).toEqual({ busy: false, value: 2 })
  })
  it('libera aunque falle y solo el propietario libera', async () => {
    const store = memoryLockStore()
    await expect(withLock(store, 'k', 'a', async () => { throw new Error('x') })).rejects.toThrow()
    expect(store.size()).toBe(0)
    await store.tryAcquire('k', 'a', 1000, 0); await store.release('k', 'intruso'); expect(store.size()).toBe(1)
  })
})
