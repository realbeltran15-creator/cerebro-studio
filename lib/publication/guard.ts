export type PublicationIntent = {
  ownerId: string
  platform: string
  projectId?: string | null
  idempotencyKey: string
}

export type ApprovalRecord = {
  owner_id: string
  action_type: string
  action_key: string
  status: string
}

export function publicationApprovalKey(intent: PublicationIntent) {
  return `${intent.platform}:${intent.idempotencyKey}`
}

/**
 * Hard application-level publication gate.
 * Provider adapters must call this before any external publish operation.
 * Database RLS and approvals remain an independent second layer.
 */
export function assertPublicationApproved(
  intent: PublicationIntent,
  approval: ApprovalRecord | null | undefined,
) {
  const expectedKey = publicationApprovalKey(intent)
  const allowed =
    approval?.owner_id === intent.ownerId &&
    approval.action_type === 'publish' &&
    approval.action_key === expectedKey &&
    approval.status === 'approved'

  if (!allowed) {
    throw new Error('Publication blocked: explicit approval is required.')
  }
}
