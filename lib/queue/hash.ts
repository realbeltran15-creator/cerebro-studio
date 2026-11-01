import { createHash } from 'node:crypto'

/** JSON estable (claves ordenadas) para sellar aprobaciones y huellas. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const hashPayload = (payload: unknown) => sha256(stableStringify(payload))
