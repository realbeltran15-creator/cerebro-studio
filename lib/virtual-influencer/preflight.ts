import type { AdapterDefinition, AdapterStatus } from './providers'

/**
 * Decides whether a generation job may be dispatched. It never spends: dispatch happens elsewhere
 * and only when this returns no blocking reasons. With a 0 EUR budget every paid job is blocked,
 * and a job whose cost cannot be estimated is blocked too (no unbounded spend).
 */

export type PreflightInput = {
  adapter: AdapterDefinition | null
  adapterStatus: AdapterStatus
  budgetEur: number
  spentEur: number
  estimatedCostEur: number | null
  identityApproved: boolean
  approvedReferenceCount: number
  prompt: string
  voiceProfileApproved?: boolean
}

export function preflight(p: PreflightInput): string[] {
  const reasons: string[] = []
  if (!p.adapter) return ['Proveedor desconocido.']
  if (p.adapterStatus !== 'CONNECTED') reasons.push(`NOT_CONNECTED: ${p.adapter.label} no está conectado.`)
  if (!p.identityApproved && p.adapter.kind !== 'voice') reasons.push('La identidad no tiene una versión aprobada.')
  if (p.adapter.referenceConditioning && p.adapter.kind !== 'voice' && p.approvedReferenceCount === 0) reasons.push('No hay referencias aprobadas para condicionar la identidad.')
  if (!p.adapter.referenceConditioning && p.adapter.kind !== 'voice') reasons.push('Este proveedor no usa referencias: no puede garantizar la identidad (solo exploración).')
  if (p.adapter.kind === 'voice' && p.voiceProfileApproved === false) reasons.push('El Voice Profile no está aprobado.')
  if (!p.prompt.trim()) reasons.push('Falta la descripción (prompt) del contenido.')
  if (p.adapter.paid) {
    const available = Math.max(p.budgetEur - p.spentEur, 0)
    if (p.budgetEur <= 0) reasons.push('Presupuesto de 0 EUR: no se generan contenidos de pago.')
    else if (p.estimatedCostEur === null) reasons.push('Coste no estimable para este proveedor: no se ejecuta sin un coste máximo conocido.')
    else if (p.estimatedCostEur > available) reasons.push(`Coste estimado ${p.estimatedCostEur.toFixed(2)} EUR supera el presupuesto disponible ${available.toFixed(2)} EUR.`)
  }
  return reasons
}

export const jobStatusLabels: Record<string, string> = {
  draft: 'Borrador', blocked: 'Bloqueado', queued: 'En cola', running: 'Generando', needs_review: 'Pendiente de revisión',
  approved: 'Aprobado', rejected: 'Rechazado', failed: 'Falló',
}

/** Allowed status transitions for generation jobs (enforced by the API routes). */
const transitions: Record<string, string[]> = {
  draft: ['blocked', 'queued'],
  blocked: ['draft', 'queued', 'blocked'],
  queued: ['running', 'failed', 'blocked'],
  running: ['needs_review', 'failed'],
  needs_review: ['approved', 'rejected'],
  approved: [],
  rejected: ['draft'],
  failed: ['draft'],
}

export function canTransition(from: string, to: string) {
  return transitions[from]?.includes(to) ?? false
}
