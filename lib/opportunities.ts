/** Postgres unique_violation: another request saved the same opportunity first (see 20261007120000_opportunities_unique_source.sql). */
export const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'

// Structural type that both the Supabase client and a test double satisfy.
type InsertClient = { from: (t: 'opportunities') => { insert: (rows: never) => PromiseLike<{ error: { code?: string; message: string } | null }> } }

/** Inserts a batch; if a concurrent save already holds some rows, falls back to one by one and counts the duplicates instead of failing the batch. */
export async function insertOpportunities(db: InsertClient, rows: unknown[]): Promise<{ saved: number; duplicates: number }> {
  if (!rows.length) return { saved: 0, duplicates: 0 }
  const batch = await db.from('opportunities').insert(rows as never)
  if (!batch.error) return { saved: rows.length, duplicates: 0 }
  if (!isUniqueViolation(batch.error)) throw new Error(batch.error.message)
  let saved = 0, duplicates = 0
  for (const row of rows) {
    const one = await db.from('opportunities').insert(row as never)
    if (!one.error) saved++
    else if (isUniqueViolation(one.error)) duplicates++
    else throw new Error(one.error.message)
  }
  return { saved, duplicates }
}
