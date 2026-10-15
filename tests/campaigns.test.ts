import { describe, expect, it } from 'vitest'
import { EMPTY_BRIEF, type Brief } from '@/lib/campaigns/types'
import { buildStrategy, rankPlatforms, suggestPlatforms, assumptionFor } from '@/lib/campaigns/strategy'
import { campaignReport } from '@/lib/campaigns/report'
import { NETWORKS, adapters, isPublishAvailable, readiness } from '@/lib/campaigns/connections'
import { KEY, create, duplicate, loadCampaigns, remove, sanitizeBrief, saveCampaigns, upsert } from '@/lib/campaigns/store'

const b = (o: Partial<Brief> = {}): Brief => ({ ...EMPTY_BRIEF, ...o })
const full = b({ name: 'Lanzamiento', subject: 'channel', subjectName: 'Umbral del Hito', goal: 'subscribers', countries: ['US', 'DE'], ageMin: 18, ageMax: 44, interests: 'ciencia, curiosidades', platforms: ['youtube_organic', 'google_ads', 'meta_ads'], totalBudget: 900, dailyCap: 40, durationDays: 28, startDate: '2026-11-02', expectedMetric: 'subscribers', expectedValue: 600 })

describe('campaigns: the nine questions can be answered partially', () => {
  it('an empty brief still produces a plan and tells what to complete', () => {
    const s = buildStrategy(b())
    expect(s.answered).toBe(0); expect(s.questions).toHaveLength(9); expect(s.suggestions.length).toBeGreaterThan(3)
    expect(s.scenarios).toBeNull(); expect(s.calendar.length).toBe(5); expect(s.rules.length).toBeGreaterThan(3)
  })
  it('a partial brief recommends platforms, a daily cap and a duration instead of inventing a budget', () => {
    const s = buildStrategy(b({ subject: 'store', subjectName: 'Mi tienda', goal: 'sales', totalBudget: 600 }))
    expect(s.answered).toBe(3)
    expect(s.budget.suggestedDays).toBe(28); expect(s.budget.suggestedDailyCap).toBe(Math.ceil((600 / 28) * 1.25))
    expect(s.budget.total).toBe(600)
    expect(s.suggestions.join(' ')).toMatch(/Plataformas sugeridas/)
    expect(s.warnings.join(' ')).toMatch(/conversiones/)
  })
  it('no budget → a labelled pilot suggestion, never a silent default budget', () => {
    const s = buildStrategy(b({ goal: 'traffic', platforms: ['meta_ads'] }))
    expect(s.budget.total).toBeNull(); expect(s.budget.pilotBudget).toBe(140); expect(s.suggestions.join(' ')).toMatch(/piloto/); expect(s.scenarios).toBeNull()
  })
})

describe('campaigns: platform choice, organic / paid / mixed', () => {
  it('budget 0 means organic only: no paid platform is suggested', () => {
    const ids = suggestPlatforms(b({ goal: 'views', subject: 'video', totalBudget: 0 }))
    expect(ids.every(i => i.endsWith('_organic'))).toBe(true)
    expect(buildStrategy(b({ goal: 'views', subject: 'video', totalBudget: 0 })).mode).toBe('organic')
  })
  it('a small budget concentrates on a single paid platform', () => {
    const paid = suggestPlatforms(b({ goal: 'sales', subject: 'product', totalBudget: 100 })).filter(i => i.endsWith('_ads'))
    expect(paid).toHaveLength(1)
  })
  it('modes follow the chosen platforms', () => {
    expect(buildStrategy(b({ platforms: ['google_ads'] })).mode).toBe('paid')
    expect(buildStrategy(b({ platforms: ['tiktok_organic'] })).mode).toBe('organic')
    expect(buildStrategy(full).mode).toBe('mixed')
  })
  it('every ranked platform explains itself', () => { for (const p of rankPlatforms(full)) expect(p.reasons.length).toBeGreaterThan(0) })
})

describe('campaigns: budget, calendar, scenarios, rules', () => {
  const s = buildStrategy(full)
  it('splits only the paid platforms, keeps 10 % as reserve and adds up to the total', () => {
    expect(s.budget.lines.map(l => l.platform).sort()).toEqual(['google_ads', 'meta_ads'])
    const sum = s.budget.lines.reduce((t, l) => t + l.amount, 0) + s.budget.reserve
    expect(Math.abs(sum - 900)).toBeLessThan(0.05)
    expect(s.budget.phases.reduce((t, p) => t + p.pct, 0)).toBe(100)
  })
  it('warns when the daily cap cannot spend the total in the time', () => {
    const w = buildStrategy(b({ ...full, dailyCap: 10 })).warnings.join(' ')
    expect(w).toMatch(/90 días/); expect(w).toMatch(/33/)
  })
  it('warns when a small daily cap is spread over several paid platforms', () => {
    expect(buildStrategy(b({ ...full, dailyCap: 8 })).warnings.join(' ')).toMatch(/menos de 5 por plataforma/)
  })
  it('the calendar covers the whole duration with real dates when there is a start date', () => {
    expect(s.calendar[1].from).toBe('2026-11-02'); expect(s.calendar.at(-1)!.toDay).toBe(28); expect(s.calendar[0].from).toBe('2026-10-26')
    for (let i = 2; i < 4; i++) expect(s.calendar[i].fromDay).toBe(s.calendar[i - 1].toDay + 1)
  })
  it('scenarios are ordered, computed from visible assumptions and compared with the goal', () => {
    const sc = s.scenarios!
    expect(sc.scenarios.map(x => x.name)).toEqual(['Conservador', 'Base', 'Optimista'])
    expect(sc.scenarios[0].results).toBeLessThan(sc.scenarios[1].results); expect(sc.scenarios[1].results).toBeLessThan(sc.scenarios[2].results)
    expect(sc.scenarios[1].pctOfGoal).toBe(Math.round((sc.scenarios[1].results / 600) * 100))
    expect(sc.note).toMatch(/NO datos medidos/)
    const base = sc.scenarios[1], a = s.budget.lines.reduce((t, l) => { const x = assumptionFor(full, l.platform); return t + (l.amount / x.cpm) * 1000 * x.ctr * x.conversion }, 0)
    expect(Math.abs(base.results - Math.round(a))).toBeLessThanOrEqual(1)
  })
  it('user assumptions override the examples and change the scenarios', () => {
    const cheap = buildStrategy(b({ ...full, assumptions: { google_ads: { cpm: 2 }, meta_ads: { cpm: 2 } } }))
    expect(cheap.scenarios!.scenarios[1].results).toBeGreaterThan(s.scenarios!.scenarios[1].results)
    expect(cheap.scenarios!.assumptions.every(a => a.custom)).toBe(true)
  })
  it('organic-only campaigns get no invented numbers', () => {
    const o = buildStrategy(b({ ...full, platforms: ['youtube_organic'], totalBudget: 0 }))
    expect(o.scenarios).toBeNull(); expect(o.scenarioNote).toMatch(/orgánico/)
  })
  it('stop / optimise / expand rules carry the cost target computed from budget ÷ expected result', () => {
    const r = s.rules.find(x => x.kind === 'ampliar')!
    expect(r.when).toMatch(/1,5 EUR/)
    expect(new Set(s.rules.map(x => x.kind))).toEqual(new Set(['detener', 'optimizar', 'ampliar']))
  })
  it('changing the budget, goal or platforms recomputes without losing the rest', () => {
    const more = buildStrategy(b({ ...full, totalBudget: 1800, goal: 'traffic', platforms: ['meta_ads'] }))
    expect(more.budget.lines).toHaveLength(1); expect(more.budget.lines[0].amount).toBe(1620); expect(more.answered).toBe(buildStrategy(full).answered)
  })
})

describe('campaigns: creatives link to the Studio and the report is complete', () => {
  it('creative pieces point at existing Studio sections', () => {
    const hrefs = buildStrategy(full).creatives.map(c => c.studioHref)
    expect(hrefs).toEqual(expect.arrayContaining(['/scripts', '/thumbnails', '/editor', '/repurpose']))
  })
  it('the report has every promised section and never claims to have published', () => {
    const md = campaignReport(full, '2026-10-15T00:00:00Z')
    for (const must of ['## 1. Brief', '## 2. Estrategia y plataformas', '## 3. Público', '## 4. Contenido y anuncios', '## 5. Presupuesto', '## 6. Calendario', '## 7. Indicadores', '## 8. Escenarios estimados', '## 9. Cuándo detener, optimizar o ampliar', '## 10. Conexiones publicitarias', '## Límites', 'NO medidos', 'no se ha publicado ningún anuncio']) expect(md, must).toContain(must)
    expect(campaignReport(b()).length).toBeGreaterThan(500)
  })
})

describe('campaigns: ad connections are honest', () => {
  it('no adapter exists, so nothing is available and nothing is simulated', () => {
    expect(Object.keys(adapters)).toHaveLength(0)
    for (const n of NETWORKS) expect(isPublishAvailable(n.network)).toBe(false)
  })
  it('credentials alone never make a connection available, and values never leak', () => {
    const r = readiness({ GOOGLE_ADS_DEVELOPER_TOKEN: 'secret-x', GOOGLE_ADS_CLIENT_ID: 'a', GOOGLE_ADS_CLIENT_SECRET: 'b' })
    const g = r.find(x => x.network === 'google_ads')!
    expect(g.credentialsPresent).toBe(true); expect(g.adapterImplemented).toBe(false); expect(g.state).toBe('credenciales_sin_conexion')
    expect(JSON.stringify(r)).not.toContain('secret-x')
    expect(r.find(x => x.network === 'meta_ads')!.state).toBe('no_disponible')
  })
  it('each network lists approvals, scopes and a documentation link', () => { for (const n of NETWORKS) { expect(n.requirements.length).toBeGreaterThanOrEqual(3); expect(n.docs).toMatch(/^https:/); expect(n.scopes.length).toBeGreaterThan(0) } })
})

describe('campaigns: saving without any connection', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
  it('saves, reloads, duplicates, edits and removes', () => {
    const s = mem(); let list = upsert([], create(full))
    expect(saveCampaigns(s, list)).toBe(true)
    list = loadCampaigns(s); expect(list).toHaveLength(1); expect(list[0].brief.totalBudget).toBe(900)
    list = duplicate(list, list[0].id); expect(list).toHaveLength(2); expect(list[0].brief.name).toMatch(/copia/)
    list = upsert(list, { ...list[1], brief: { ...list[1].brief, totalBudget: 1200 } }); expect(list.find(c => c.id === list[1].id)!.brief.totalBudget).toBe(1200)
    list = remove(list, list[0].id); expect(list).toHaveLength(1)
  })
  it('corrupt or hostile stored data is cleaned, not trusted', () => {
    const s = mem(); s.setItem(KEY, '{bad'); expect(loadCampaigns(s)).toEqual([])
    const clean = sanitizeBrief({ totalBudget: -5, goal: 'hack', platforms: ['meta_ads', 'evil'], currency: 'XXX', durationDays: 9999, assumptions: { meta_ads: { cpm: -1, ctr: 5 }, evil: { cpm: 1 } } })
    expect(clean.totalBudget).toBeNull(); expect(clean.goal).toBeNull(); expect(clean.platforms).toEqual(['meta_ads']); expect(clean.currency).toBe('EUR'); expect(clean.durationDays).toBeNull(); expect(clean.assumptions).toEqual({})
  })
})

describe('campaigns: Investigación → Campañas keeps the evidence, and the Studio links carry the project', () => {
  it('the link round-trips topic, market, verdict, indices and date without recomputing anything', async () => {
    const { campaignLink, briefFromLink } = await import('@/lib/campaigns/link')
    const url = campaignLink({ topic: 'huerto en casa', region: 'DE', language: 'de', verdict: 'oportunidad', demand: 71.4, competition: 32, opportunity: 66, fetchedAt: '2026-10-13T12:00:00.000Z', opportunityId: 'opp-1' })
    const brief = briefFromLink(url.split('?')[1])!
    expect(brief.countries).toEqual(['DE']); expect(brief.subjectName).toBe('huerto en casa'); expect(brief.goal).toBe('subscribers')
    expect(brief.source!.summary).toMatch(/veredicto de Investigación: oportunidad, demanda 71\/100, competencia 32\/100, oportunidad 66\/100/)
    expect(brief.source!.opportunityId).toBe('opp-1'); expect(brief.source!.fetchedAt).toBe('2026-10-13T12:00:00.000Z'); expect(brief.source!.language).toBe('de')
    const strategy = buildStrategy({ ...EMPTY_BRIEF, ...brief } as Brief)
    expect(strategy.origin).toMatch(/Tema «huerto en casa»/); expect(campaignReport({ ...EMPTY_BRIEF, ...brief } as Brief)).toContain('Datos del 2026-10-13')
  })
  it('hostile or malformed links are neutralised', async () => {
    const { briefFromLink } = await import('@/lib/campaigns/link')
    expect(briefFromLink('')).toBeNull()
    const b = briefFromLink('topic=x&country=<script>&verdict=evil&demand=999&at=nope&lang=zzz')!
    expect(b.countries).toEqual([]); expect(b.source!.summary).not.toMatch(/evil|999/); expect(b.source!.fetchedAt).toBe(''); expect(b.source!.language).toBe('')
  })
  it('the source survives saving and loading', () => {
    const c = create({ ...full, source: { opportunityId: 'o', summary: 's', language: 'de', fetchedAt: '2026-10-13' }, kpis: ['CTR'] })
    expect(sanitizeBrief(JSON.parse(JSON.stringify(c.brief))).source?.opportunityId).toBe('o'); expect(c.brief.kpis).toEqual(['CTR'])
  })
  it('creative links open the linked project, and the language of each market is stated', () => {
    const s = buildStrategy(b({ ...full, projectId: 'p-9' }))
    expect(s.creatives.find(c => c.studioLabel === 'Abrir Guiones')!.studioHref).toBe('/scripts?project=p-9')
    expect(s.creatives.find(c => /Textos de anuncio/.test(c.title))!.studioHref).toBe('/projects/p-9')
    expect(s.creatives[0].spec).toMatch(/Idioma de las piezas: en, de/)
  })
  it('chosen KPIs replace the suggested ones in the report', () => {
    expect(campaignReport(b({ ...full, kpis: ['Suscriptores ganados'] }))).toMatch(/\*\*A seguir:\*\* Suscriptores ganados/)
    expect(buildStrategy(full).chosenKpis.length).toBeGreaterThan(2)
  })
})

describe('review fixes: short campaigns, mismatched metrics, bad input', () => {
  const dur = (d: number, extra: Partial<Brief> = {}) => buildStrategy(b({ ...full, durationDays: d, ...extra }), Date.parse('2026-10-15T00:00:00Z'))
  it('the calendar never overlaps, never runs backwards and ends on the last day, for every duration from 1 to 60', () => {
    for (let d = 1; d <= 60; d++) {
      const cal = dur(d).calendar.filter(p => p.fromDay >= 1)
      expect(cal[0].fromDay, `d=${d}`).toBe(1)
      for (const p of cal) { expect(p.toDay, `d=${d} ${p.name}`).toBeGreaterThanOrEqual(p.fromDay); expect(p.toDay, `d=${d} ${p.name}`).toBeLessThanOrEqual(d) }
      for (let i = 1; i < cal.length - 1; i++) expect(cal[i].fromDay, `d=${d}`).toBe(cal[i - 1].toDay + 1)
      expect(cal.at(-1)!.name).toBe('Cierre e informe'); expect(cal.at(-1)!.toDay).toBe(d)
      for (const p of cal) if (p.from && p.to) expect(p.from <= p.to, `d=${d} dates`).toBe(true)
    }
  })
  it('under 7 days the plan is compact and every mode gets the warning', () => {
    expect(dur(3).calendar.map(p => p.name)).toEqual(['Preparación', 'Lanzamiento y medición', 'Cierre e informe'])
    expect(dur(3, { platforms: ['youtube_organic'], totalBudget: 0 }).warnings.join(' ')).toMatch(/menos de 7 días/)
  })
  it('scenarios are only compared with the goal when both use the same metric', () => {
    const m = dur(28, { goal: 'sales', expectedMetric: 'views', expectedValue: 10000 })
    expect(m.scenarios!.scenarios.every(s => s.pctOfGoal === null)).toBe(true)
    expect(m.warnings.join(' ')).toMatch(/no se comparan los escenarios/)
    expect(m.rules.find(r => r.kind === 'ampliar')!.when).not.toMatch(/0,09 EUR/)
  })
  it('a zero daily cap is not accepted and a start date must be a real date', async () => {
    const { sanitizeBrief, validDate } = await import('@/lib/campaigns/store')
    expect(sanitizeBrief({ dailyCap: 0 }).dailyCap).toBeNull()
    expect(buildStrategy(b({ ...full, dailyCap: 0 })).warnings.join(' ')).not.toMatch(/Infinity/)
    expect(validDate('2026-02-31')).toBe(''); expect(validDate('2026-13-01')).toBe(''); expect(validDate('2026-02-28')).toBe('2026-02-28')
    expect(dur(14, { startDate: '2026-02-31' }).warnings.join(' ')).toMatch(/no es una fecha válida/)
    expect(dur(14, { startDate: '2026-10-01' }).warnings.join(' ')).toMatch(/ya ha pasado/)
  })
  it('a paid platform with a zero budget says so instead of "falta el presupuesto"', () => {
    const z = buildStrategy(b({ goal: 'traffic', platforms: ['meta_ads'], totalBudget: 0 }))
    expect(z.warnings.join(' ')).toMatch(/Presupuesto 0 con plataformas de pago/); expect(z.scenarioNote).toMatch(/es 0/)
  })
  it('changing the status updates the modification date', async () => {
    const { setStatus } = await import('@/lib/campaigns/store')
    const c = create(full, '2026-10-01T00:00:00Z')
    expect(setStatus([c], c.id, 'lista', '2026-10-02T00:00:00Z')[0].updatedAt).toBe('2026-10-02T00:00:00Z')
  })
})
