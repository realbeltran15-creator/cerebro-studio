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

export type ScriptBasis = 'verified_fact' | 'testimony' | 'reconstruction' | 'interpretation'

export interface ScriptSection {
  id: string
  heading: string
  basis: ScriptBasis
  text: string
  /** URLs or references that support this section. */
  sources: string[]
  /** Who is speaking, for verified testimony. */
  speaker?: string
}

export interface ScriptRow {
  id: string
  owner_id: string
  project_id: string
  source_opportunity_id: string | null
  parent_id: string | null
  version: number
  title: string
  status: 'draft' | 'review' | 'approved' | 'archived'
  idea: string | null
  brief: string | null
  hook: string | null
  cta: string | null
  sections: ScriptSection[]
  review_notes: string | null
  created_at: string
  updated_at: string
}

export interface StoryboardRow {
  id: string
  owner_id: string
  project_id: string
  script_id?: string | null
  title: string
  aspect_ratio: string
  version: number
  created_at: string
  updated_at: string
}

export interface SceneRow {
  id: string
  owner_id: string
  storyboard_id: string
  position: number
  duration_ms: number
  narration: string | null
  visual_prompt: string | null
  video_prompt: string | null
  ambient_prompt: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface AssetRow {
  id: string
  owner_id: string
  project_id: string | null
  asset_type: string
  storage_path: string | null
  source_provider: string | null
  source_url: string | null
  license_status: string
  provenance: Record<string, unknown>
  created_at: string
}

export interface MetricSnapshotRow {
  id: number
  owner_id: string
  project_id: string | null
  platform: string
  external_content_id: string
  metric_date: string
  observed: Record<string, unknown>
  calculated: Record<string, unknown>
  created_at: string
}
