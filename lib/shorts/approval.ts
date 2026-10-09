import { independentReliableSources } from './gates'
import { DEFAULT_CONFIG, type Facts, type GateResult } from './types'

export type ApprovalRow = { owner_id: string; action_type: string; entity_type: string; entity_id: string; status: string }

/**
 * Puerta dura de publicación para Shorts. El esquema desplegado de `approvals` usa entity_type/entity_id
 * (no action_key), por eso no se reutiliza lib/publication/guard.ts, que asume otro esquema.
 */
export function assertShortApproved(ownerId: string, shortId: string, approval: ApprovalRow | null | undefined) {
  const ok = approval?.owner_id === ownerId && approval.action_type === 'publish' && approval.entity_type === 'short'
    && approval.entity_id === shortId && approval.status === 'approved'
  if (!ok) throw new Error('Subida bloqueada: este Short no tiene una aprobación explícita de Jesús.')
}

/** Revalida en el servidor los controles previos a la aprobación (no se fía del cliente). */
export function approvalBlockers(short: { status: string; quality?: { gates?: GateResult[] } | null; facts?: Partial<Facts> | null }, confirmations: { sources?: boolean; hook?: boolean }) {
  const blockers: string[] = []
  if (short.status !== 'ready_for_approval') blockers.push(`estado «${short.status}»: solo se aprueba un Short listo para aprobación`)
  const failed = (short.quality?.gates ?? []).filter(g => !g.pass)
  if (!short.quality?.gates?.length) blockers.push('sin informe de controles')
  failed.forEach(g => blockers.push(`control fallido: ${g.name} (${g.detail})`))
  const sources = independentReliableSources(short.facts?.sources ?? [], DEFAULT_CONFIG.reliableDomains)
  if (sources.length < 2) blockers.push('menos de 2 fuentes fiables e independientes')
  if (!confirmations.sources) blockers.push('falta confirmar que has revisado las fuentes')
  if (!confirmations.hook) blockers.push('falta confirmar hook y dato principal de los primeros 2 s')
  return blockers
}
