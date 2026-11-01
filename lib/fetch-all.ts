/** Reads every row of a query page by page. Throws if the table is larger than `maxPages` pages, never returns a silently truncated list. */
export async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize = 500, maxPages = 40): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(i * pageSize, i * pageSize + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
  throw new Error(`Hay demasiados registros para comprobarlos con seguridad (más de ${maxPages * pageSize}).`)
}
