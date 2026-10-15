import { EMPTY_BRIEF, type Brief, type CampaignStatus, type SavedCampaign } from './types'

/**
 * Campaigns are saved in this browser (localStorage) so they can be designed and kept with no ad connection and no database change.
 * `supabase/migrations/20261015120000_campaigns.sql` prepares a server-side table; it is NOT applied until the owner approves it.
 */
export const KEY = 'cerebro.campaigns.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, 40) : [])
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null)

const strsLong = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 80).slice(0, 20) : [])
function sanitizeSource(v: unknown): Brief['source'] {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return { opportunityId: str(o.opportunityId, 64), summary: str(o.summary, 600), language: str(o.language, 5), fetchedAt: str(o.fetchedAt, 40) }
}

export function sanitizeBrief(raw: unknown): Brief {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ass: Brief['assumptions'] = {}
  if (r.assumptions && typeof r.assumptions === 'object') for (const [k, v] of Object.entries(r.assumptions as Record<string, unknown>)) {
    if (!['google_ads', 'meta_ads', 'tiktok_ads'].includes(k) || !v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>, a: Partial<Record<'cpm' | 'ctr' | 'conversion', number>> = {}
    for (const f of ['cpm', 'ctr', 'conversion'] as const) { const n = num(o[f]); if (n !== null && (f === 'cpm' ? n > 0 : n <= 1)) a[f] = n }
    if (Object.keys(a).length) ass[k as 'google_ads'] = a
  }
  return {
    ...EMPTY_BRIEF, name: str(r.name, 120), subject: oneOf(r.subject, ['video', 'channel', 'product', 'store', 'project', 'other']), subjectName: str(r.subjectName, 200), subjectUrl: str(r.subjectUrl, 500),
    goal: oneOf(r.goal, ['awareness', 'views', 'subscribers', 'traffic', 'leads', 'sales', 'engagement']), countries: strs(r.countries), ageMin: num(r.ageMin), ageMax: num(r.ageMax),
    interests: str(r.interests), audienceNotes: str(r.audienceNotes, 1000),
    platforms: strs(r.platforms).filter((p): p is Brief['platforms'][number] => ['youtube_organic', 'instagram_organic', 'tiktok_organic', 'google_ads', 'meta_ads', 'tiktok_ads'].includes(p)),
    totalBudget: num(r.totalBudget), dailyCap: num(r.dailyCap), durationDays: (() => { const n = num(r.durationDays); return n !== null && n >= 1 && n <= 365 ? Math.round(n) : null })(), startDate: /^\d{4}-\d{2}-\d{2}$/.test(str(r.startDate, 10)) ? str(r.startDate, 10) : '',
    expectedMetric: oneOf(r.expectedMetric, ['views', 'clicks', 'subscribers', 'leads', 'sales', 'reach']), expectedValue: num(r.expectedValue), currency: oneOf(r.currency, ['EUR', 'USD', 'GBP', 'CHF']) ?? 'EUR',
    projectId: str(r.projectId, 64), sourceTopic: str(r.sourceTopic, 200), source: sanitizeSource(r.source), kpis: strsLong(r.kpis), assumptions: ass,
  }
}

export function loadCampaigns(s: Store | null): SavedCampaign[] {
  try {
    const raw = s?.getItem(KEY); if (!raw) return []
    const list = JSON.parse(raw) as unknown; if (!Array.isArray(list)) return []
    return list.flatMap((x): SavedCampaign[] => {
      const o = x as Record<string, unknown>; if (!o || typeof o.id !== 'string') return []
      return [{ id: o.id, brief: sanitizeBrief(o.brief), status: oneOf(o.status, ['borrador', 'lista', 'archivada'] as const) ?? 'borrador', notes: str(o.notes, 2000), createdAt: str(o.createdAt, 40), updatedAt: str(o.updatedAt, 40) }]
    })
  } catch { return [] }
}
export function saveCampaigns(s: Store | null, list: SavedCampaign[]): boolean { try { s?.setItem(KEY, JSON.stringify(list)); return !!s } catch { return false } }
export const newId = () => `cmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export function create(brief: Brief = EMPTY_BRIEF, now = new Date().toISOString()): SavedCampaign { return { id: newId(), brief: sanitizeBrief(brief), status: 'borrador', notes: '', createdAt: now, updatedAt: now } }
export function upsert(list: SavedCampaign[], c: SavedCampaign, now = new Date().toISOString()): SavedCampaign[] { const next = { ...c, updatedAt: now }; return list.some(x => x.id === c.id) ? list.map(x => (x.id === c.id ? next : x)) : [next, ...list] }
export const remove = (list: SavedCampaign[], id: string) => list.filter(c => c.id !== id)
export function duplicate(list: SavedCampaign[], id: string, now = new Date().toISOString()): SavedCampaign[] { const c = list.find(x => x.id === id); if (!c) return list; const d = create({ ...c.brief, name: `${c.brief.name || c.brief.subjectName || 'Campaña'} (copia)` }, now); return [d, ...list] }
export const setStatus = (list: SavedCampaign[], id: string, status: CampaignStatus) => list.map(c => (c.id === id ? { ...c, status } : c))
