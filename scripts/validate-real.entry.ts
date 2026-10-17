import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { MemoryCacheStore, quotaDayStart } from '@/lib/research/cache'
import { getGrowth, getTopicAnalysis } from '@/lib/research/sample'
import { quotaLimits } from '@/lib/research/quota'
import { searchYouTubeVideosMeta, type YouTubeSearchInput, type YouTubeVideoResult } from '@/lib/providers/youtube-data'
import { nicheRevenue, videoRevenue } from '@/lib/research/revenue'
import { growthStatus, type TopicAnalysis } from '@/lib/research/topic-analysis'

const selftest = process.argv.includes('--selftest')
if (!selftest && !process.env.YOUTUBE_API_KEY?.trim()) { console.error('Falta YOUTUBE_API_KEY en el entorno: no se puede validar con datos reales. (Usa --selftest solo para comprobar el script con datos SIMULADOS.)'); process.exit(2) }

const CASES = [
  { id: 'etf-de', topic: 'ETF Sparplan erklärt', region: 'DE', language: 'de' },
  { id: 'ftb-gb', topic: 'first time buyer', region: 'GB', language: 'en' },
  { id: 'ftb-us', topic: 'first time buyer', region: 'US', language: 'en' },
]
let calls = 0
const fake = async (i: YouTubeSearchInput) => ({ approxTotal: 100, videos: Array.from({ length: 25 }, (_, k): YouTubeVideoResult => ({ videoId: `sim${k}`, url: 'https://example.invalid', title: `${i.query} simulado ${k}`, channelId: `c${k}`, channelTitle: 'SIMULADO', publishedAt: new Date(Date.now() - (5 + k) * 86400000).toISOString(), thumbnailUrl: null, declaredLanguage: i.language ?? 'en', observed: { views: 1000 + k, likes: 1, comments: 1, durationSeconds: 600, channelSubscribers: 1000, fetchedAt: '' }, calculated: { viewsPerDay: 100, viewsToSubscribers: 1, engagementRate: 1 } } as YouTubeVideoResult)) })
const search = async (i: YouTubeSearchInput) => { calls++; return selftest ? fake(i) : searchYouTubeVideosMeta(i) }

const store = new MemoryCacheStore(`validate-${Date.now()}`)
const day = quotaDayStart(), limits = quotaLimits()
const spent = async () => ({ units: await store.unitsSince(day), searches: await store.searchesSince(day) })
const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), simulated: selftest, caps: { units: limits.unitCap, searches: limits.searchCap } }
const md: string[] = [`# Validación ${selftest ? 'SIMULADA (no es una validación)' : 'con datos reales de YouTube'} — ${new Date().toISOString().slice(0, 10)}`, '']
const results: Record<string, TopicAnalysis> = {}
const checks: Array<[string, boolean]> = []

for (const c of CASES) {
  const before = await spent(), callsBefore = calls
  const r = await getTopicAnalysis({ topic: c.topic, region: c.region, language: c.language }, { store, search: search as never, owner: 'validate' })
  const a = r.analysis!; results[c.id] = a
  const after = await spent(), used = { units: after.units - before.units, searches: after.searches - before.searches }
  const st = (s: string) => a.sample.filter(v => v.status === s).length
  const accepted = a.sample.filter(v => v.status === 'aceptado')
  const rev = nicheRevenue(a)
  console.log(`\n== ${c.topic} · ${c.region} ==  cuota: ${used.units} unidades, ${used.searches} búsquedas · aceptados ${st('aceptado')} · dudosos ${st('dudoso')} · descartados ${st('descartado')} · confianza ${a.confidence} · geo: ${a.geo?.level}`)
  md.push(`## ${c.topic} — ${c.region}/${c.language}`, `- Cuota gastada: **${used.units} unidades, ${used.searches} búsquedas** (${calls - callsBefore} llamadas a search).`, `- Muestra: ${a.sample.length} vídeos → aceptados ${st('aceptado')}, dudosos ${st('dudoso')}, descartados ${st('descartado')} (motivos: ${JSON.stringify(a.quality.excluded)}).`,
    `- Veredicto: ${a.verdict} · oportunidad ${a.indices.opportunity}/100 · confianza **${a.confidence}** — ${a.confidenceNote}`, `- Geografía: **${a.geo?.level}** — ${a.geo?.statement} (apartados por hablar de otro país: ${a.geo?.setAside}; canales con país declarado: ${a.geo?.channel.known}, en el mercado: ${a.geo?.channel.inMarket}).`)
  const tr = rev.typical?.estimate
  md.push(`- Ingresos publicitarios estimados · vídeo típico: ${tr && tr.status === 'estimado' ? `${tr.formula} (confianza ${tr.confidence})` : 'no calculable'}.`, '', '**Aceptados (para revisar a mano):**')
  for (const v of accepted.slice(0, 12)) md.push(`- [${v.title}](${v.url}) — ${v.channelTitle} — ${v.views ?? '?'} vistas — idioma ${v.language ?? '?'}`)
  md.push('', '**Dudosos y descartados (primeros 12):**')
  for (const v of a.sample.filter(x => x.status !== 'aceptado').slice(0, 12)) md.push(`- ${v.status}/${v.reason}: [${v.title}](${v.url}) — ${v.detail}`)
  md.push('', '**Vídeos de respaldo con estimación por vídeo:**')
  for (const v of a.topVideos.slice(0, 5)) { const e = videoRevenue(v, c.region); md.push(`- [${v.title}](${v.url}) — ${v.observed.views ?? '?'} vistas — ${e.status === 'estimado' ? `$${e.range.low}–$${e.range.high}` : 'desconocido'}`) }
  md.push('')
  out[c.id] = { used, counts: { aceptado: st('aceptado'), dudoso: st('dudoso'), descartado: st('descartado') }, confidence: a.confidence, geo: a.geo, verdict: a.verdict, accepted: accepted.map(v => ({ t: v.title, u: v.url, l: v.language })) }
  checks.push([`${c.id}: gasta como mucho 204 unidades y 2 búsquedas`, used.units <= 204 && used.searches <= 2])
  checks.push([`${c.id}: tiene confianza y geografía explicadas`, !!a.confidenceNote && !!a.geo])
  if (c.id === 'etf-de') checks.push(['etf-de: ningún vídeo aceptado en un idioma distinto del alemán', accepted.every(v => v.language === null || v.language === 'de')])
  if (c.id === 'ftb-gb') checks.push(['ftb-gb: ninguna presentación como demanda local verificada', !/verificad/i.test(a.geo?.statement.replace('no es demanda local verificada', '') ?? '')])
}

// Growth: one measurement, then a second attempt that must not touch YouTube.
const g0 = await spent(), c0 = calls
const grown = await getGrowth({ topic: CASES[0].topic, region: CASES[0].region, language: CASES[0].language, analysis: results['etf-de'] }, { store, search: search as never, owner: 'validate' })
const g1 = await spent(), c1 = calls
const again = await getGrowth({ topic: CASES[0].topic, region: CASES[0].region, language: CASES[0].language, analysis: grown.analysis }, { store, search: search as never, owner: 'validate' })
const g2 = await spent()
const gs = growthStatus(grown.analysis!)
md.push('## Crecimiento (caso ETF Sparplan)', `- Primera medición: +${g1.units - g0.units} unidades, ${g1.searches - g0.searches} búsqueda → estado **${gs.kind}**, ${grown.analysis!.growth.state === 'calculable' ? grown.analysis!.growth.label : 'no calculable'} — ${grown.analysis!.growth.reason}`, `- Segundo intento: +${g2.units - g1.units} unidades, ${calls - c1} llamadas (cacheado: ${again.cached}).`, '')
checks.push(['crecimiento: la primera medición cuesta como mucho 102 unidades y 1 búsqueda', g1.units - g0.units <= 102 && g1.searches - g0.searches <= 1 && calls - c0 === 1])
checks.push(['crecimiento: la segunda medición no llama a YouTube ni gasta cuota', calls - c1 === 0 && g2.units === g1.units && again.cached])
const total = await spent()
md.push('## Total', `- Cuota total: **${total.units} unidades, ${total.searches} búsquedas** (previsto: 714 y 7).`, '', '## Comprobaciones automáticas', ...checks.map(([n, ok]) => `- ${ok ? '✓' : '✗'} ${n}`), '', 'Estas comprobaciones automáticas no sustituyen a la lectura humana de los vídeos aceptados y descartados listados arriba.')
checks.push(['total: no supera 714 unidades ni 7 búsquedas', total.units <= 714 && total.searches <= 7])
out.total = total; out.checks = checks
const dir = path.resolve('research-output'); mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().slice(0, 10)
writeFileSync(path.join(dir, `validation-${selftest ? 'selftest-' : ''}${stamp}.md`), md.join('\n')); writeFileSync(path.join(dir, `validation-${selftest ? 'selftest-' : ''}${stamp}.json`), JSON.stringify(out, null, 1))
console.log(`\nTotal: ${total.units} unidades, ${total.searches} búsquedas.`); for (const [n, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${n}`)
console.log(`Informe: research-output/validation-${selftest ? 'selftest-' : ''}${stamp}.md`)
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
