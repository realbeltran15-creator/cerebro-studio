import { describe, expect, it } from 'vitest'
import { METHOD, concentration, demandProfile, entryDifficulty, medianInterval, methodLines, opportunityOf, sensitivity, smallChannelWins, verdictOf } from '@/lib/research/statistics'

// SIMULATED data: these tests check the arithmetic and the guard rails, not what YouTube returns.
describe('concentration of views', () => {
  it('many channels with similar shares: low; three giants among many tiny ones: high', () => {
    const even = Array.from({ length: 12 }, (_, i) => ({ channelId: `c${i}`, views: 1000 }))
    expect(concentration(even).level).toBe('baja')
    const giants = [...[0, 1, 2].map(i => ({ channelId: `g${i}`, views: 1_000_000 })), ...Array.from({ length: 12 }, (_, i) => ({ channelId: `t${i}`, views: 1000 }))]
    const c = concentration(giants); expect(c.level).toBe('alta'); expect(c.top3).toBeGreaterThan(0.9)
  })
  it('fewer than three channels: no invented number', () => { expect(concentration([{ channelId: 'a', views: 10 }, { channelId: 'b', views: 5 }])).toMatchObject({ hhi: null, level: 'sin datos' }) })
  it('the same channel with several videos counts once (its views add up)', () => {
    const c = concentration([{ channelId: 'a', views: 900 }, { channelId: 'a', views: 900 }, { channelId: 'b', views: 100 }, { channelId: 'c', views: 100 }])
    expect(c.channels).toBe(3); expect(c.top1).toBeGreaterThan(0.8)
  })
})

describe('small channels that do well, and entry difficulty', () => {
  it('counts only videos whose channel size is known, and needs 3 small channels before drawing a share', () => {
    expect(smallChannelWins([{ subs: 1000, views: 5000 }, { subs: null, views: 9000 }]).share).toBeNull()
    const s = smallChannelWins([{ subs: 1000, views: 5000 }, { subs: 2000, views: 100 }, { subs: 3000, views: 4000 }, { subs: 900_000, views: 5_000_000 }])
    expect(s).toMatchObject({ known: 4, small: 3, wins: 2 }); expect(s.share).toBeCloseTo(2 / 3)
  })
  it('channels with misleading statistics (hidden or zero subscribers, absurd view ratios) are not counted as small winners', () => {
    const s = smallChannelWins([{ subs: null, views: 9_000_000 }, { subs: 0, views: 500_000 }, { subs: 12, views: 5_000_000 }, { subs: 1000, views: 3000 }, { subs: 2000, views: 100 }, { subs: 3000, views: 3500 }])
    expect(s.known).toBe(3); expect(s.wins).toBe(2); expect(s.small).toBe(3)
  })
  it('a saturated niche is never «baja»: high competition + concentrated views + heavy supply', () => {
    const e = entryDifficulty({ competition: 85, supply: 90, concentration: { channels: 10, hhi: 3200, top1: 0.5, top3: 0.8, level: 'alta' }, smallWins: { known: 10, small: 3, wins: 0, share: 0 } })
    expect(e.saturated).toBe(true); expect(e.level).toBe('alta')
  })
  it('small channels succeeding lowers the difficulty', () => {
    const base = { competition: 60, supply: 50, concentration: { channels: 12, hhi: 1700, top1: 0.3, top3: 0.5, level: 'media' as const } }
    expect(entryDifficulty({ ...base, smallWins: { known: 10, small: 6, wins: 4, share: 0.67 } }).level).not.toBe('alta')
    expect(entryDifficulty({ ...base, smallWins: { known: 10, small: 6, wins: 4, share: 0.67 } }).level).toBe('baja')
  })
  it('without data says so instead of guessing', () => { expect(entryDifficulty({ competition: 40, supply: 40, concentration: concentration([]), smallWins: smallChannelWins([]) }).level).toBe('sin datos') })
})

describe('sustained demand vs one hit', () => {
  const ok = { topVpd: 1000, recentVpd: 600, oneVideoShare: 0.15, outliers: 0, relevantTop: 20, relevantRecent: 15 }
  it('sustained when recent videos keep a comparable pace', () => { expect(demandProfile(ok).kind).toBe('sostenida') })
  it('one video holding most views is a one-off, not niche demand', () => { expect(demandProfile({ ...ok, oneVideoShare: 0.7 }).kind).toBe('puntual') })
  it('recent videos far below the yearly top: the interest may be over', () => { expect(demandProfile({ ...ok, recentVpd: 50 }).kind).toBe('puntual') })
  it('too few relevant videos: insufficient, never «sostenida»', () => { expect(demandProfile({ ...ok, relevantTop: 4 }).kind).toBe('insuficiente') })
})

describe('score arithmetic, thresholds and sensitivity', () => {
  it('weights add up to 100 % and the printed method is generated from them', () => {
    const w = METHOD.opportunityWeights; expect(w.demand + w.openCompetition + w.openSupply + w.growth).toBeCloseTo(1)
    expect(methodLines().join(' ')).toContain('45 %')
  })
  it('growth not calculable rescales the other weights instead of adding a neutral value', () => {
    expect(opportunityOf(80, 20, 20, null)).toBe(Math.round((0.45 * 80 + 0.25 * 80 + 0.2 * 80) / 0.9))
    expect(opportunityOf(80, 20, 20, 0)).toBeLessThan(opportunityOf(80, 20, 20, null))
  })
  it('no demand caps the opportunity whatever the rest says', () => { expect(opportunityOf(10, 0, 0, null)).toBeLessThanOrEqual(20); expect(verdictOf(10, 0, 0)).toBe('sin_demanda') })
  it('a borderline case is reported as sensitive; a clear one as stable', () => {
    expect(sensitivity({ demand: 52, competition: 54, supply: 58, growth: null }).stable).toBe(false)
    expect(sensitivity({ demand: 80, competition: 25, supply: 25, growth: null }).stable).toBe(true)
  })
  it('median interval needs 8+ values and brackets the median', () => {
    expect(medianInterval([1, 2, 3])).toBeNull()
    const i = medianInterval([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])!; expect(i.lo).toBeLessThanOrEqual(6.5); expect(i.hi).toBeGreaterThanOrEqual(6.5)
  })
})
