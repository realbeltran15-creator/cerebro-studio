// Runs Cerebro Studio's guided research from the command line, with the SAME code the app uses (lib/research/*) and the real YouTube Data API.
// Needs YOUTUBE_API_KEY in the environment. Progress is stored in a JSON file so it resumes the next day; the daily budget is enforced.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { COUNTRIES } from '@/lib/research/discovery'
import { marketsFromFilters } from '@/lib/research/markets'
import { budgetPlan, jobKey, pendingJobs, planGuided, reportCsv, reportMarkdown } from '@/lib/research/guided'
import { BudgetError, dailyCap, getTopicAnalysis } from '@/lib/research/sample'
import { searchYouTubeVideosMeta, YouTubeApiError } from '@/lib/providers/youtube-data'
import { cacheKey, quotaDayStart, type CacheHit, type CacheStore } from '@/lib/research/cache'
import { UNITS } from '@/lib/research/filters'
import { recentDaysFrom } from '@/lib/research/markets'
import type { TopicAnalysis } from '@/lib/research/topic-analysis'

const arg = (name: string, d?: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d }
const flag = (name: string) => process.argv.includes(`--${name}`)

const markets = marketsFromFilters({ countries: (arg('markets', 'US,DE,AU,GB,CA,CH') as string).split(',').map(s => s.trim().toUpperCase()).filter(c => COUNTRIES.some(x => x.code === c)), languages: [] })
const niches = (arg('niches', '') as string).split(',').map(s => s.trim()).filter(Boolean)
const per = Math.min(Math.max(Number(arg('per', '20')) || 20, 1), 20)
const recentDays = recentDaysFrom(arg('days') ? Number(arg('days')) : null)
const dir = path.resolve(arg('dir', '.research') as string), out = path.resolve(arg('out', 'research-output') as string)
const file = path.join(dir, 'progress.json')

type Row = { payload: TopicAnalysis; fetchedAt: string; units: number; searches?: number }
type State = { rows: Record<string, Row & { key: string }>; created: string }
const state: State = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { rows: {}, created: new Date().toISOString() }
const save = () => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(state)) }

/** File-backed store: the same interface as the app's cache, so caching and the daily budget behave identically. */
const store: CacheStore = {
  persistent: true,
  async get<T>(key: string, now = Date.now()): Promise<CacheHit<T> | null> { const r = state.rows[key]; return r && now - Date.parse(r.fetchedAt) < 7 * 86400000 ? { payload: r.payload as unknown as T, fetchedAt: r.fetchedAt, units: r.units } : null },
  async put(key, _kind, payload, units, _ttl, now = Date.now(), searches = 0) { state.rows[key] = { key, payload: payload as TopicAnalysis, fetchedAt: new Date(now).toISOString(), units, searches }; save() },
  async searchesSince(since: number) { return Object.values(state.rows).filter(r => Date.parse(r.fetchedAt) >= since).reduce((t, r) => t + (r.searches ?? 0), 0) },
  async unitsSince(since: number) { return Object.values(state.rows).filter(r => Date.parse(r.fetchedAt) >= since).reduce((t, r) => t + r.units, 0) },
  // One process, one file: nothing runs concurrently here, so a plain check-then-write is already atomic.
  atomic: true,
  async delete(key) { delete state.rows[key]; save() },
  async reserve(key, units, cap, _ttl, now = Date.now(), searches) {
    const day = Object.values(state.rows).filter(r => Date.parse(r.fetchedAt) >= quotaDayStart(now))
    const used = day.reduce((t, r) => t + r.units, 0), usedSearches = day.reduce((t, r) => t + (r.searches ?? 0), 0)
    if (used + units > cap) return { ok: false as const, reason: 'budget' as const, used, usedSearches }
    if (searches && usedSearches + searches.need > searches.cap) return { ok: false as const, reason: 'search_budget' as const, used, usedSearches }
    state.rows[key] = { key, payload: {} as TopicAnalysis, fetchedAt: new Date(now).toISOString(), units, searches: searches?.need ?? 0 }; save(); return { ok: true as const, used: used + units, usedSearches: usedSearches + (searches?.need ?? 0) }
  },
  async settle(key, actual, now = Date.now(), actualSearches = 0) { state.rows[key] = { key, payload: {} as TopicAnalysis, fetchedAt: new Date(now).toISOString(), units: Math.round(actual), searches: Math.round(actualSearches) }; save() },
  async release(key) { delete state.rows[key]; save() },
  async lock() { return true },
  async unlock() { /* nothing to release */ },
}

const { jobs, shortfall, fallbackMarkets } = planGuided({ markets, nicheIds: niches, perMarket: per })
const done: Record<string, unknown> = {}
for (const j of jobs) { const hit = await store.get(cacheKey('topic', [j.topic, j.market.region, j.market.language, String(recentDays)])); if (hit) done[jobKey(j, recentDays)] = hit.payload }
const cap = dailyCap(), used = await store.unitsSince(quotaDayStart())
const bp = budgetPlan({ jobs, done, recentDays, remainingToday: Math.max(cap - used, 0), dailyCap: cap })
console.log(`Mercados: ${markets.map(m => m.label).join(', ')} · ${per} por mercado · ${jobs.length} análisis planificados`)
if (shortfall.length) console.log(`Faltan ideas: ${shortfall.map(s => `${s.market} (${s.got}/${s.wanted})`).join(', ')} → elige más nichos con --niches`)
if (fallbackMarkets.length) console.log(`Sin catálogo propio (se usan ideas en inglés): ${fallbackMarkets.join(', ')}`)
console.log(bp.message, `Hoy ya se han usado ${used} de ${cap} unidades.`)

if (!flag('dry')) {
  if (!process.env.YOUTUBE_API_KEY?.trim()) { console.error('Falta YOUTUBE_API_KEY en el entorno: no se puede consultar YouTube. Usa --dry para ver el plan sin consultar.'); process.exit(2) }
  let ok = 0
  for (const j of pendingJobs(jobs, done, recentDays).slice(0, bp.todayJobs)) {
    try {
      const r = await getTopicAnalysis({ topic: j.topic, region: j.market.region, language: j.market.language, recentDays }, { store, search: searchYouTubeVideosMeta, cap })
      done[jobKey(j, recentDays)] = r.analysis; ok++
      console.log(`✓ ${String(ok).padStart(3)}  ${j.market.label.padEnd(24)} ${j.topic}  → ${r.analysis!.verdict} (oportunidad ${r.analysis!.indices.opportunity})`)
    } catch (e) {
      if (e instanceof BudgetError) { console.log(`Presupuesto agotado: ${e.message}`); break }
      if (e instanceof YouTubeApiError && (e.status === 403 || e.status === 503)) { console.error(`YouTube: ${e.message}`); break }
      console.error(`✗ ${j.market.label} · ${j.topic}: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`Hechos ahora: ${ok}. Pendientes: ${pendingJobs(jobs, done, recentDays).length}. Vuelve a ejecutar mañana para continuar.`)
}

const finished = jobs.map(j => done[jobKey(j, recentDays)] as TopicAnalysis | undefined).filter((a): a is TopicAnalysis => Boolean(a))
if (finished.length) {
  mkdirSync(out, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  writeFileSync(path.join(out, `informe-${stamp}.md`), reportMarkdown(finished, { generatedAt: new Date().toISOString() }))
  writeFileSync(path.join(out, `informe-${stamp}.csv`), `﻿${reportCsv(finished)}`)
  console.log(`Informe con ${finished.length} análisis (datos de la API a la que apunta YOUTUBE_API_KEY) en ${out}/informe-${stamp}.md y .csv`)
} else console.log('Todavía no hay análisis que informar.')
void UNITS
