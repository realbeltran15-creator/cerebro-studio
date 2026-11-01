/**
 * Presupuesto agregado por proveedor, proyecto y dia (Fase 4B.0, codigo aislado).
 * Contadores independientes por unidad: eur, usd, credits, quota. La cuota gratuita NO es dinero.
 * Predeterminado: limite 0 en todas las unidades (nada autorizado). Precio desconocido = bloqueo.
 * Espeja las funciones SQL reserve_budget / conciliacion; el ledger real (Supabase) llega en 4B.1.
 */
export type BudgetUnit = 'eur' | 'usd' | 'credits' | 'quota'
export const BUDGET_UNITS: BudgetUnit[] = ['eur', 'usd', 'credits', 'quota']

/** null = precio desconocido (bloquea). */
export type Cost = Partial<Record<BudgetUnit, number | null>>

export type ReserveResult =
  | { ok: true; reused: boolean }
  | { ok: false; code: 'unknown_price' | 'budget_exhausted' | 'invalid_amount'; unit: BudgetUnit }

export type BudgetEntry = {
  key: string
  ownerId: string
  jobId: string
  step: string
  provider: string
  projectId: string | null
  unit: BudgetUnit
  day: string
  reserved: number
  actual: number | null
  state: 'reserved' | 'uncertain' | 'settled' | 'released'
}

export type BudgetLedger = {
  setLimit(l: { ownerId: string; provider: string; projectId?: string | null; unit: BudgetUnit; dailyLimit: number }): void
  /** Atomica: o reserva todas las unidades o ninguna. */
  reserve(r: { ownerId: string; jobId: string; step: string; provider: string; projectId: string | null; cost: Cost; keyBase: string; now: Date }): ReserveResult
  settle(keyBase: string, ownerId: string, actual: Cost): void
  /** Libera SOLO lo que sigue «reserved». Una reserva «uncertain» (quizá cobrada) nunca se libera sola. */
  release(keyBase: string, ownerId: string): void
  /** Marca como incierta una reserva cuyo cobro no se puede descartar. Sigue contando contra el límite. */
  markUncertain(keyBase: string, ownerId: string): void
  /** Decisión humana sobre lo incierto: cobrado (se concilia) o no cobrado (se libera). */
  resolveUncertain(keyBase: string, ownerId: string, r: { charged: boolean; actual?: Cost }): void
  used(ownerId: string, provider: string, unit: BudgetUnit, now: Date): number
  entries(): BudgetEntry[]
}

export const dayOf = (d: Date) => d.toISOString().slice(0, 10)

export function createMemoryLedger(): BudgetLedger {
  const limits: Array<{ ownerId: string; provider: string; projectId: string | null; unit: BudgetUnit; dailyLimit: number }> = []
  const list: BudgetEntry[] = []
  const limitFor = (ownerId: string, provider: string, projectId: string | null, unit: BudgetUnit) => {
    const m = limits.filter(l => l.ownerId === ownerId && l.provider === provider && l.unit === unit && (l.projectId === null || l.projectId === projectId))
    return m.length ? Math.min(...m.map(l => l.dailyLimit)) : 0
  }
  const usedOf = (ownerId: string, provider: string, unit: BudgetUnit, day: string) =>
    list.filter(e => e.ownerId === ownerId && e.provider === provider && e.unit === unit && e.day === day && e.state !== 'released')
      .reduce((s, e) => s + (e.state === 'settled' ? (e.actual ?? 0) : e.reserved), 0)

  return {
    setLimit: l => {
      const pid = l.projectId ?? null
      const i = limits.findIndex(x => x.ownerId === l.ownerId && x.provider === l.provider && x.projectId === pid && x.unit === l.unit)
      const row = { ownerId: l.ownerId, provider: l.provider, projectId: pid, unit: l.unit, dailyLimit: Math.max(0, l.dailyLimit) }
      if (i >= 0) limits[i] = row; else limits.push(row)
    },
    reserve: r => {
      const day = dayOf(r.now)
      const wanted: Array<[BudgetUnit, number]> = []
      for (const unit of BUDGET_UNITS) {
        const v = r.cost[unit]
        if (v === undefined) continue
        if (v === null) return { ok: false, code: 'unknown_price', unit }
        if (!Number.isFinite(v) || v < 0) return { ok: false, code: 'invalid_amount', unit }
        wanted.push([unit, v])
      }
      const keys = wanted.map(([unit]) => `${r.keyBase}:${unit}`)
      if (wanted.length && keys.every(k => list.some(e => e.key === k && e.ownerId === r.ownerId))) return { ok: true, reused: true }
      for (const [unit, v] of wanted) {
        if (usedOf(r.ownerId, r.provider, unit, day) + v > limitFor(r.ownerId, r.provider, r.projectId, unit)) {
          return { ok: false, code: 'budget_exhausted', unit }   // nada reservado: todo o nada
        }
      }
      wanted.forEach(([unit, v]) => list.push({
        key: `${r.keyBase}:${unit}`, ownerId: r.ownerId, jobId: r.jobId, step: r.step, provider: r.provider,
        projectId: r.projectId, unit, day, reserved: v, actual: null, state: 'reserved',
      }))
      return { ok: true, reused: false }
    },
    settle: (keyBase, ownerId, actual) => {
      for (const e of list) {
        if (e.ownerId !== ownerId || !e.key.startsWith(`${keyBase}:`) || (e.state !== 'reserved' && e.state !== 'uncertain')) continue
        const a = actual[e.unit]
        e.actual = typeof a === 'number' && a >= 0 ? a : e.reserved   // sin dato real: se mantiene lo reservado
        e.state = 'settled'
      }
    },
    release: (keyBase, ownerId) => {
      for (const e of list) if (e.ownerId === ownerId && e.key.startsWith(`${keyBase}:`) && e.state === 'reserved') e.state = 'released'
    },
    markUncertain: (keyBase, ownerId) => {
      for (const e of list) if (e.ownerId === ownerId && e.key.startsWith(`${keyBase}:`) && e.state === 'reserved') e.state = 'uncertain'
    },
    resolveUncertain: (keyBase, ownerId, r) => {
      for (const e of list) {
        if (e.ownerId !== ownerId || !e.key.startsWith(`${keyBase}:`) || e.state !== 'uncertain') continue
        if (r.charged) { const a = r.actual?.[e.unit]; e.actual = typeof a === 'number' && a >= 0 ? a : e.reserved; e.state = 'settled' } else e.state = 'released'
      }
    },
    used: (ownerId, provider, unit, now) => usedOf(ownerId, provider, unit, dayOf(now)),
    entries: () => list.map(e => ({ ...e })),
  }
}

/** Un coste es «gratis» solo si todas sus cantidades son exactamente 0 (ninguna desconocida). */
export const isFreeCost = (c: Cost) => Object.values(c).every(v => v === 0)

import type { Asyncify } from '@/lib/queue/types'
/** Lo que necesita el ejecutor: el mismo contrato, sincrono (memoria) o asincrono (PostgreSQL). */
export type AsyncBudgetLedger = Asyncify<Pick<BudgetLedger, 'reserve' | 'settle' | 'release' | 'markUncertain' | 'resolveUncertain' | 'used' | 'setLimit'>>
