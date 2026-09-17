export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ProjectStatus = 'draft' | 'active' | 'archived'
export type OpportunityStatus = 'discovered' | 'researching' | 'candidate' | 'approved' | 'discarded'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type PublicationStatus = 'draft' | 'pending_approval' | 'approved' | 'publishing' | 'published' | 'failed'

export interface ProjectRow {
  id: string
  owner_id: string
  name: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface OpportunityRow {
  id: string
  owner_id: string
  title: string
  source_platform: string
  source_query: string | null
  region: string | null
  language: string | null
  status: string
  confidence: number | null
  observed_metrics: Record<string, unknown> | null
  calculated_metrics: Record<string, unknown> | null
  evidence: Json
  created_at: string
  updated_at: string
}

export interface ApprovalRow {
  id: string
  owner_id: string
  project_id: string | null
  action_type: string
  action_key: string
  status: string
  context: Json
  decided_at: string | null
  created_at: string
}

export interface PublicationJobRow {
  id: string
  owner_id: string
  project_id: string | null
  platform: string
  status: string
  idempotency_key: string | null
  payload: Json
  approved_at: string | null
  published_at: string | null
  created_at: string
}

/**
 * Minimal checked-in application contract. Replace/extend this with generated
 * Supabase types as schema automation is introduced. Never place secrets or
 * OAuth tokens in client-visible database types.
 */
export interface DatabaseContract {
  projects: ProjectRow
  opportunities: OpportunityRow
  approvals: ApprovalRow
  publication_jobs: PublicationJobRow
}
