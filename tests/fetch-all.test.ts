import { describe, expect, it } from 'vitest'
import { fetchAllPages } from '@/lib/fetch-all'

const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }))
const pager = (rows: Array<{ id: number }>) => async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null })

describe('fetchAllPages', () => {
  it('lee todas las filas aunque superen el tamaño de página', async () => {
    expect(await fetchAllPages(pager(table(1234)), 500)).toHaveLength(1234)
    expect(await fetchAllPages(pager(table(1000)), 500)).toHaveLength(1000) // múltiplo exacto: lee una página vacía final
    expect(await fetchAllPages(pager(table(0)), 500)).toEqual([])
  })
  it('propaga errores y no devuelve listas truncadas', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
    await expect(fetchAllPages(pager(table(5000)), 10, 3)).rejects.toThrow('demasiados')
  })
})
