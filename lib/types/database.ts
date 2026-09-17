export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface ProjectRow {
  id: string
  owner_id: string
  name: string
  description: string | null
  status: string
  target_platforms: string[]
  created_at: string
  updated_at: string
}

export interface OpportunityRow {
  id: string
  owner_id: string
  project_id: string | null
  source_platform: string
  source_id: string | null
  query: string | null
  region: string | null
  language: string | null
  title: string
  status: string
  observed_metrics: Record<string, unknown>
  calculated_metrics: Record<string, unknown>
  evidence: Json
  confidence: number | null
  created_at: string
  updated_at: string
}

export interface ApprovalRow {
  id: string
  owner_id: string
  action_type: string
  entity_type: string
  entity_id: string
  status: string
  risk_summary: string | null
  requested_at: string
  decided_at: string | null
}

export interface PublicationJobRow {
  id: string
  owner_id: string
  project_id: string
  platform: string
  status: string
  scheduled_for: string | null
  approved_at: string | null
  approved_by: string | null
  idempotency_key: string | null
  payload: Json
  result: Json
  created_at: string
  updated_at: string
}

export interface DatabaseContract {
  projects: ProjectRow
  opportunities: OpportunityRow
  approvals: ApprovalRow
  publication_jobs: PublicationJobRow
}
