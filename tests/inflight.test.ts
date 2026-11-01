import { describe, expect, it } from 'vitest'
import { inflightCount, withInflight } from '@/lib/inflight'

describe('withInflight', () => {
  it('rechaza la segunda ejecución simultánea de la misma clave y libera al terminar', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const first = withInflight('k', async () => { await gate; return 1 })
    const second = await withInflight('k', async () => 2)
    expect(second).toEqual({ busy: true })
    release()
    expect(await first).toEqual({ busy: false, value: 1 })
    expect(inflightCount()).toBe(0)
    expect(await withInflight('k', async () => 3)).toEqual({ busy: false, value: 3 })
  })
  it('libera la clave aunque falle', async () => {
    await expect(withInflight('e', async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(inflightCount()).toBe(0)
  })
  it('claves distintas no se bloquean', async () => {
    const a = withInflight('a', async () => 'a'); const b = await withInflight('b', async () => 'b')
    expect(b).toEqual({ busy: false, value: 'b' }); expect(await a).toEqual({ busy: false, value: 'a' })
  })
})
