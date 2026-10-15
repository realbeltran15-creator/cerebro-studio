/**
 * Campaign model. A campaign is a BRIEF (the user's answers, all optional) plus ASSUMPTIONS the user can edit. Everything else
 * (strategy, budget split, calendar, scenarios, rules, report) is derived from those two by pure functions, so changing a budget,
 * an objective or a platform recomputes the plan instead of starting again.
 */
export type Subject = 'video' | 'channel' | 'product' | 'store' | 'project' | 'other'
export type Goal = 'awareness' | 'views' | 'subscribers' | 'traffic' | 'leads' | 'sales' | 'engagement'
export type Mode = 'organic' | 'paid' | 'mixed'
export type PlatformId = 'youtube_organic' | 'instagram_organic' | 'tiktok_organic' | 'google_ads' | 'meta_ads' | 'tiktok_ads'
export type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF'
export type ResultMetric = 'views' | 'clicks' | 'subscribers' | 'leads' | 'sales' | 'reach'

/** Editable cost assumptions for one paid platform. They are EDITORIAL examples, never measured results. */
export type Assumption = { cpm: number; ctr: number; /** Share of clicks that become the chosen result. */ conversion: number }

export type Brief = {
  name: string
  /** 1 */ subject: Subject | null; subjectName: string; subjectUrl: string
  /** 2 */ goal: Goal | null
  /** 3 */ countries: string[]
  /** 4 */ ageMin: number | null; ageMax: number | null; interests: string; audienceNotes: string
  /** 5 */ platforms: PlatformId[]
  /** 6 */ totalBudget: number | null
  /** 7 */ dailyCap: number | null
  /** 8 */ durationDays: number | null; startDate: string
  /** 9 */ expectedMetric: ResultMetric | null; expectedValue: number | null
  currency: Currency
  /** Optional links to the rest of Cerebro Studio. */
  projectId: string; sourceTopic: string
  /** Where the idea came from (Investigación): kept so the plan and the report can cite the evidence, never re-computed here. */
  source: { opportunityId: string; summary: string; language: string; fetchedAt: string } | null
  /** KPIs the user chose to track (empty = the suggested ones). */
  kpis: string[]
  /** Per-platform overrides of the example assumptions. */
  assumptions: Partial<Record<PlatformId, Partial<Assumption>>>
}

export const EMPTY_BRIEF: Brief = {
  name: '', subject: null, subjectName: '', subjectUrl: '', goal: null, countries: [], ageMin: null, ageMax: null, interests: '', audienceNotes: '',
  platforms: [], totalBudget: null, dailyCap: null, durationDays: null, startDate: '', expectedMetric: null, expectedValue: null, currency: 'EUR', projectId: '', sourceTopic: '', source: null, kpis: [], assumptions: {},
}

export type CampaignStatus = 'borrador' | 'lista' | 'archivada'
export type SavedCampaign = { id: string; brief: Brief; status: CampaignStatus; notes: string; createdAt: string; updatedAt: string }
