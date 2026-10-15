import { COUNTRIES } from '@/lib/research/discovery'
import { COUNTRY_TIER, DEFAULT_ASSUMPTIONS, DEFAULT_INTERACTION_RATE, DEFAULT_VIEW_RATE, GOALS, GOAL_CONVERSION, GOAL_METRIC, IMPRESSION_BASED, PLATFORMS, SUBJECTS, TIER_FACTOR, METRICS, modeOf, platformInfo } from './catalog'
import { startOfUtcDay } from '@/lib/research/cache'
import { validDate } from './store'
import { PLAYBOOKS, kindOf, type Playbook } from './playbooks'
import type { Assumption, Brief, Goal, Mode, PlatformId } from './types'

export type QuestionState = { n: number; key: string; question: string; done: boolean; answer: string; hint: string }
export type PlatformPlan = { id: PlatformId; label: string; kind: 'organic' | 'paid'; score: number; chosen: boolean; reasons: string[]; formats: string[]; needs: string }
export type Segment = { name: string; description: string; requires: string }
export type ContentItem = { platform: string; item: string; cadence: string }
export type Creative = { title: string; spec: string; platforms: string[]; studioHref: string; studioLabel: string }
export type BudgetLine = { platform: PlatformId; label: string; amount: number; pct: number; /** Why this line is zero, when it is. */ note?: string }
export type BudgetPhase = { name: string; pct: number; amount: number }
export type Concentration = { recommended: boolean; applied: boolean; main: PlatformId | null; reason: string; exception: string | null }
export type BudgetPlan = { concentration: Concentration; total: number | null; daily: number | null; days: number | null; currency: string; lines: BudgetLine[]; phases: BudgetPhase[]; reserve: number; warnings: string[]; suggestedDailyCap: number | null; suggestedDays: number | null; pilotBudget: number | null }
export type CalendarPhase = { name: string; fromDay: number; toDay: number; from: string | null; to: string | null; tasks: string[] }
export type Scenario = { name: 'Conservador' | 'Base' | 'Optimista'; spend: number; impressions: number; clicks: number; results: number; costPerResult: number | null; pctOfGoal: number | null }
export type ScenarioSet = { metricLabel: string; assumptions: Array<{ id: PlatformId; platform: string; cpm: number; ctr: number; conversion: number; rate: number; /** What the result is a share of. */ basis: 'clics' | 'impresiones'; custom: boolean }>; scenarios: Scenario[]; note: string }
export type Feasibility = { state: 'realista' | 'ambicioso' | 'poco_realista' | 'sin_base' | 'no_comparable'; headline: string; detail: string; budgetForGoal: number | null }
export type Rule = { kind: 'detener' | 'optimizar' | 'ampliar'; /** Which part of a mixed campaign the rule governs. */ scope: 'pago' | 'orgánico' | 'ambos'; when: string; then: string }
export type Strategy = {
  mode: Mode | null; answered: number; questions: QuestionState[]; suggestions: string[]; summary: string
  platforms: PlatformPlan[]; audience: { demographics: string; markets: string[]; segments: Segment[] }
  content: ContentItem[]; creatives: Creative[]; budget: BudgetPlan; calendar: CalendarPhase[]; kpis: Array<{ platform: string; kpis: string[] }>
  scenarios: ScenarioSet | null; scenarioNote: string; rules: Rule[]; warnings: string[]
  /** Evidence carried from Investigación, cited as received. */
  origin: string | null
  kind: { id: string; label: string; blurb: string; inferred: boolean }
  feasibility: Feasibility
  /** KPIs to track: the user's choice, or all the suggested ones. */
  kpiOptions: string[]; chosenKpis: string[]
}

const METRIC_ONE = { views: 'visualización', clicks: 'clic', subscribers: 'suscriptor', leads: 'contacto', sales: 'venta', reach: 'persona alcanzada', interactions: 'interacción' } as const
const label = <T extends string>(list: Array<[T, string, ...string[]]>, v: T | null) => list.find(x => x[0] === v)?.[1] ?? ''
const countryName = (c: string) => COUNTRIES.find(x => x.code === c)?.name ?? c
const money = (n: number, cur: string) => `${n.toLocaleString('es-ES', { maximumFractionDigits: n < 100 ? 2 : 0 })} ${cur}`
const round2 = (n: number) => Math.round(n * 100) / 100
const addDays = (iso: string, d: number) => { const t = Date.parse(`${iso}T00:00:00Z`); return Number.isFinite(t) ? new Date(t + d * 86400000).toISOString().slice(0, 10) : null }

/** Cost metrics only exist where money is spent: an organic platform never shows a cost per result. */
const COST_KPI = /coste|roas|cpa|cpm|cpc|cpv/i
function kpisFor(id: PlatformId, goal: Goal | null): string[] {
  const p = platformInfo(id)
  const list = (goal && p.kpis[goal]) || (p.kind === 'paid' ? ['Impresiones', 'Clics', 'Coste por resultado'] : ['Impresiones', 'Visualizaciones', 'Interacciones'])
  return p.kind === 'organic' ? list.filter(k => !COST_KPI.test(k)) : list
}

/** Typical duration by objective (editorial): enough days for a test, an optimisation and a scale phase. */
export const SUGGESTED_DAYS: Record<Goal, number> = { awareness: 21, views: 14, subscribers: 28, traffic: 14, leads: 21, sales: 28, engagement: 21 }

export function questionsOf(b: Brief): QuestionState[] {
  const subj = label(SUBJECTS, b.subject)
  const q = (n: number, key: string, question: string, done: boolean, answer: string, hint: string): QuestionState => ({ n, key, question, done, answer, hint })
  return [
    q(1, 'subject', '¿Qué quieres promocionar?', !!b.subject && !!b.subjectName.trim(), b.subject ? `${subj}${b.subjectName ? `: ${b.subjectName}` : ''}` : '', 'Elige qué es y ponle nombre; con una URL (vídeo, canal o tienda) el informe la cita.'),
    q(2, 'goal', '¿Cuál es el objetivo de la campaña?', !!b.goal, label(GOALS, b.goal), 'Un solo objetivo principal: define las plataformas, los indicadores y las reglas.'),
    q(3, 'countries', '¿En qué países o regiones?', b.countries.length > 0, b.countries.map(countryName).join(', '), 'Empieza con 1–3 mercados; cada uno necesita su idioma y su presupuesto mínimo.'),
    q(4, 'audience', '¿A qué público quieres llegar?', (b.ageMin !== null || b.ageMax !== null || !!b.interests.trim() || !!b.audienceNotes.trim()), [b.ageMin !== null || b.ageMax !== null ? `${b.ageMin ?? '13'}–${b.ageMax ?? '65+'} años` : '', b.interests.trim()].filter(Boolean).join(' · '), 'Edad, intereses y una frase sobre quién es y qué problema tiene.'),
    q(5, 'platforms', '¿Qué plataformas quieres utilizar?', b.platforms.length > 0, b.platforms.map(p => platformInfo(p).label).join(', '), 'Si no eliges, se proponen según objetivo, tipo de contenido y presupuesto.'),
    q(6, 'budget', '¿Cuál es el presupuesto total?', b.totalBudget !== null, b.totalBudget !== null ? money(b.totalBudget, b.currency) : '', 'Pon 0 para una campaña solo orgánica; sin cifra se propone un piloto.'),
    q(7, 'dailyCap', '¿Cuál es el presupuesto diario máximo?', b.dailyCap !== null, b.dailyCap !== null ? money(b.dailyCap, b.currency) : '', 'Es el límite de gasto por día, también para las plataformas de pago.'),
    q(8, 'duration', '¿Cuánto durará la campaña?', b.durationDays !== null, b.durationDays !== null ? `${b.durationDays} días${b.startDate ? ` desde ${b.startDate}` : ''}` : '', 'Mínimo orientativo: 7 días para poder probar, optimizar y decidir.'),
    q(9, 'result', '¿Qué resultados esperas conseguir?', b.expectedValue !== null && b.expectedMetric !== null, b.expectedValue !== null && b.expectedMetric ? `${b.expectedValue.toLocaleString('es-ES')} ${label(METRICS, b.expectedMetric).toLowerCase()}` : '', 'Una cifra y una métrica; permite calcular el coste máximo por resultado.'),
  ]
}

/** Ranks platforms for a brief: objective fit + content-type fit, adjusted for budget and markets. Editorial scoring, explained per platform. */
export function rankPlatforms(b: Brief): PlatformPlan[] {
  const goal = b.goal, subject = b.subject
  const paidAllowed = b.totalBudget === null || b.totalBudget > 0
  return PLATFORMS.map(p => {
    const g = goal ? p.fit[goal] ?? 2 : 3, s = subject ? p.subjects[subject] ?? 3 : 3
    let score = g * 2 + s
    const reasons: string[] = []
    if (goal) reasons.push(`Encaje con «${label(GOALS, goal)}»: ${g}/5 (criterio editorial).`)
    if (subject) reasons.push(`Encaje con «${label(SUBJECTS, subject)}»: ${s}/5 (criterio editorial).`)
    if (p.kind === 'paid' && !paidAllowed) { score = 0; reasons.push('Presupuesto 0: solo orgánico.') }
    if (p.kind === 'paid' && b.totalBudget !== null && b.totalBudget > 0 && b.totalBudget < 150) { score -= 2; reasons.push('Con menos de 150 en total conviene concentrar el gasto en una sola plataforma de pago.') }
    const pb = PLAYBOOKS[kindOf(b).kind]
    const boost = pb.boost[p.id] ?? 0
    if (boost && !(p.kind === 'paid' && !paidAllowed)) { score += boost; reasons.push(`${boost > 0 ? 'Favorece' : 'Resta'} el enfoque de «${pb.label}» (${boost > 0 ? '+' : ''}${boost}, criterio editorial).`) }
    if (p.kind === 'paid' && paidAllowed && pb.paid === 'desaconsejado') { score -= 3; reasons.push(`Para «${pb.label}» los anuncios de pago rara vez compensan (criterio editorial): no se sugiere.`) }
    if (p.kind === 'organic') reasons.push('Sin coste de medios, pero exige constancia y producción.')
    if (b.subject === 'video' && p.network === 'youtube') reasons.push('El vídeo ya vive en YouTube: la audiencia llega directa al vídeo.')
    if ((b.subject === 'store' || b.subject === 'product') && p.id === 'meta_ads') reasons.push('Meta permite catálogo y audiencias por interés para producto y tienda.')
    if (b.goal === 'sales' && p.kind === 'paid') reasons.push('Para ventas hace falta seguimiento de conversiones (píxel o API de conversiones) antes de gastar.')
    return { id: p.id, label: p.label, kind: p.kind, score, chosen: b.platforms.includes(p.id), reasons, formats: p.formats, needs: p.needs }
  }).sort((x, y) => y.score - x.score)
}

/** Concentrate the paid budget on ONE platform when the money is too thin to learn on several (editorial rule, stated on screen). */
export const CONCENTRATE = { totalBelow: 150, perPlatformDailyBelow: 5 } as const
export function shouldConcentrate(b: Brief, paidCount: number): boolean {
  if (paidCount < 2) return false
  if (b.totalBudget !== null && b.totalBudget > 0 && b.totalBudget < CONCENTRATE.totalBelow) return true
  const days = b.durationDays ?? (b.goal ? SUGGESTED_DAYS[b.goal] : null)
  const daily = b.dailyCap ?? (b.totalBudget && days ? b.totalBudget / days : null)
  return daily !== null && daily / paidCount < CONCENTRATE.perPlatformDailyBelow
}

/** Platforms the plan uses: the user's choice, or the best ones for the brief (up to 2 organic and 2 paid, 1 paid below 150). */
export function suggestPlatforms(b: Brief): PlatformId[] {
  const ranked = rankPlatforms(b).filter(p => p.score > 0)
  const paidMax = shouldConcentrate(b, 2) ? 1 : 2
  const paid = b.totalBudget === 0 || PLAYBOOKS[kindOf(b).kind].paid === 'desaconsejado' ? [] : ranked.filter(p => p.kind === 'paid').slice(0, paidMax)
  const organic = ranked.filter(p => p.kind === 'organic').slice(0, 2)
  return [...organic, ...paid].map(p => p.id)
}

/** Platforms the plan actually uses: the user's choice, or the suggestion when none was made. */
export const effectivePlatforms = (b: Brief): PlatformId[] => (b.platforms.length ? b.platforms : suggestPlatforms(b))

const tierFactor = (countries: string[]) => countries.length ? countries.reduce((t, c) => t + TIER_FACTOR[COUNTRY_TIER[c] ?? 'medio'], 0) / countries.length : 1

export function assumptionFor(b: Brief, id: PlatformId): Assumption & { custom: boolean } {
  const base = DEFAULT_ASSUMPTIONS[id as keyof typeof DEFAULT_ASSUMPTIONS], o = b.assumptions[id] ?? {}
  const goal = b.goal ?? 'traffic'
  const cpm = o.cpm ?? round2((base?.cpm ?? 8) * tierFactor(b.countries)), ctr = o.ctr ?? base?.ctr ?? 0.008, conversion = o.conversion ?? GOAL_CONVERSION[goal]
  const rate = o.rate ?? (goal === 'views' ? DEFAULT_VIEW_RATE[id as keyof typeof DEFAULT_VIEW_RATE] ?? 0.15 : DEFAULT_INTERACTION_RATE)
  return { cpm, ctr, conversion, rate, custom: o.cpm !== undefined || o.ctr !== undefined || o.conversion !== undefined || o.rate !== undefined }
}

/** Is the expected result measured in the same unit the scenarios produce? (sales vs views cannot be compared.) */
const sameMetric = (b: Brief) => !!b.goal && !!b.expectedMetric && GOAL_METRIC[b.goal] === b.expectedMetric

function budgetOf(b: Brief, platforms: PlatformId[], days: number | null): BudgetPlan {
  const cur = b.currency, warnings: string[] = []
  const paid = platforms.filter(p => platformInfo(p).kind === 'paid')
  const scores = new Map(rankPlatforms(b).map(p => [p.id, Math.max(p.score, 1)]))
  const total = b.totalBudget
  const lines: BudgetLine[] = []
  const RESERVE = 0.1
  // Concentrate or split: when the money is too thin to learn on several platforms the plan puts it all on the best one, unless the user
  // keeps the split on purpose (then the report records that exception and its cost).
  const recommended = shouldConcentrate(b, paid.length)
  const main = [...paid].sort((x, y) => (scores.get(y) ?? 1) - (scores.get(x) ?? 1))[0] ?? null
  const applied = recommended && !b.keepSplit
  const days0 = b.durationDays ?? (b.goal ? SUGGESTED_DAYS[b.goal] : null)
  const dailyForRule = b.dailyCap ?? (total && days0 ? total / days0 : null)
  const why = total !== null && total > 0 && total < CONCENTRATE.totalBelow ? `con ${money(total, cur)} en total` : `con ${dailyForRule !== null ? money(round2(dailyForRule), cur) : 'ese gasto'} al día entre ${paid.length} plataformas`
  const concentration: Concentration = { recommended, applied, main: recommended ? main : null,
    reason: recommended ? `Concentrar en una plataforma: ${why} cada plataforma recibiría menos de ${CONCENTRATE.perPlatformDailyBelow} ${cur} al día o la prueba total sería inferior a ${CONCENTRATE.totalBelow}; repartido en varias no habría volumen para aprender en ninguna.` : '',
    exception: recommended && b.keepSplit ? `Excepción confirmada por ti: se mantiene el reparto entre ${paid.length} plataformas aunque ${why} cada una queda con muy poco volumen. Es una decisión tuya, no la recomendada.` : null }
  if (total !== null && total > 0 && paid.length) {
    const spendable = total * (1 - RESERVE), sum = paid.reduce((t, p) => t + (scores.get(p) ?? 1), 0)
    for (const p of paid) {
      const pct = applied ? (p === main ? 1 : 0) : (scores.get(p) ?? 1) / sum
      lines.push({ platform: p, label: platformInfo(p).label, amount: round2(spendable * pct), pct: Math.round(pct * (1 - RESERVE) * 1000) / 10, ...(applied && p !== main ? { note: `En espera: se activa cuando ${platformInfo(main!).label} cumpla el coste por resultado objetivo.` } : {}) })
    }
  }
  const phases: BudgetPhase[] = total !== null && total > 0 && paid.length ? [
    { name: 'Prueba (varias creatividades y públicos pequeños)', pct: 25, amount: round2(total * 0.25) },
    { name: 'Optimización (se retira lo que no funciona)', pct: 35, amount: round2(total * 0.35) },
    { name: 'Escala (se amplía lo que funciona)', pct: 30, amount: round2(total * 0.30) },
    { name: 'Reserva (decisiones imprevistas)', pct: 10, amount: round2(total * 0.10) },
  ] : []
  const daily = total !== null && days ? round2(total / days) : null
  const suggestedDays = b.durationDays ?? (b.goal ? SUGGESTED_DAYS[b.goal] : null)
  const effDays = days ?? suggestedDays
  const suggestedDailyCap = total !== null && total > 0 && effDays ? Math.ceil((total / effDays) * 1.25) : null
  if (total !== null && total > 0 && b.dailyCap !== null && b.dailyCap > 0 && effDays) {
    const need = Math.ceil(total / b.dailyCap)
    if (need > effDays) warnings.push(`Con un máximo diario de ${money(b.dailyCap, cur)} gastar ${money(total, cur)} lleva ${need} días, y la campaña dura ${effDays}: o sube el tope diario a ${money(Math.ceil(total / effDays), cur)} o alarga la duración.`)
  }
  if (b.dailyCap !== null && total !== null && b.dailyCap > total) warnings.push('El presupuesto diario máximo es mayor que el total: el total manda.')
  if (applied) warnings.push(`${concentration.reason} Se ha puesto todo el gasto en ${platformInfo(main!).label}; las demás quedan en espera. Si prefieres repartir, marca la excepción en Presupuesto.`)
  if (concentration.exception) warnings.push(concentration.exception)
  if (total !== null && total > 0 && !paid.length) warnings.push('Hay presupuesto pero ninguna plataforma de pago elegida: se usaría para producción y herramientas, no para medios.')
  const pilotBudget = total === null && paid.length ? paid.length * 10 * 14 : null
  return { concentration, total, daily, days: effDays, currency: cur, lines, phases, reserve: total && total > 0 ? round2(total * RESERVE) : 0, warnings, suggestedDailyCap: b.dailyCap === null ? suggestedDailyCap : null, suggestedDays: b.durationDays === null ? suggestedDays : null, pilotBudget }
}

function calendarOf(b: Brief, days: number | null, mode: Mode | null, pb: Playbook): CalendarPhase[] {
  const D = days ?? (b.goal ? SUGGESTED_DAYS[b.goal] : 14)
  const start = validDate(b.startDate)
  const d = (n: number) => (start ? addDays(start, n - 1) : null)
  const paid = mode === 'paid' || mode === 'mixed'
  const prep: CalendarPhase = { name: 'Preparación', fromDay: -6, toDay: 0, from: start ? addDays(start, -7) : null, to: start ? addDays(start, -1) : null, tasks: ['Definir la propuesta en una frase y el gancho de los primeros 3 segundos.', 'Producir las piezas creativas (ver Creatividades) y 2–3 variantes del gancho.', 'Preparar el seguimiento: enlaces con UTM y, si hay conversiones, píxel o API de conversiones.', ...(paid ? ['Crear las cuentas publicitarias y el método de pago (lo hace la persona; Cerebro Studio no publica anuncios).'] : []), 'Revisar cada pieza contra derechos de autor y políticas de la plataforma.', ...pb.prep] }
  const close: CalendarPhase = { name: 'Cierre e informe', fromDay: D, toDay: D, from: d(D), to: d(D), tasks: ['Comparar resultados con el objetivo y con los escenarios.', 'Guardar qué creatividades y públicos funcionaron para la siguiente campaña.', 'Exportar el informe final.'] }
  // Under a week there is no room for test → optimise → scale: one launch-and-measure phase, honestly labelled.
  if (D < 7) return [prep, { name: 'Lanzamiento y medición', fromDay: 1, toDay: D, from: d(1), to: d(D), tasks: [paid ? 'Lanzar 2–3 creatividades con presupuesto igual y medir cada día; solo hay margen para retirar la peor.' : 'Publicar las piezas y medir cuál retiene mejor.', 'Registrar cada día: gasto, impresiones, clics y resultados.', ...pb.test] }, close]
  // 7+ days: phases never overlap and always end by day D (scale stops the day before the closing day).
  const t = Math.max(2, Math.round(D * 0.25)), o = Math.min(D - 2, t + Math.max(2, Math.round(D * 0.35)))
  return [
    prep,
    { name: 'Prueba', fromDay: 1, toDay: t, from: d(1), to: d(t), tasks: [paid ? 'Lanzar 3 creatividades × 2 públicos con presupuesto pequeño e igual.' : 'Publicar las primeras piezas y medir cuál retiene mejor.', 'No tocar nada en las primeras 48 h (las plataformas necesitan datos).', 'Registrar cada día: gasto, impresiones, clics y resultados.', ...pb.test] },
    { name: 'Optimización', fromDay: t + 1, toDay: o, from: d(t + 1), to: d(o), tasks: ['Aplicar las reglas de «detener / optimizar / ampliar» cada 3 días.', 'Retirar la creatividad y el público más débiles; duplicar variantes de la mejor.', 'Mejorar la página o el vídeo de destino si los clics no se convierten.'] },
    { name: 'Escala', fromDay: o + 1, toDay: D - 1, from: d(o + 1), to: d(D - 1), tasks: [paid ? 'Subir el presupuesto de lo que funciona un 20 % cada 3 días como máximo.' : 'Repetir el formato que mejor funcionó y reutilizarlo en las otras plataformas.', 'Añadir un mercado o una plataforma nuevos solo si el anterior cumple el coste por resultado.'] },
    close,
  ]
}

function contentOf(b: Brief, platforms: PlatformId[], pb: Playbook): ContentItem[] {
  const out: ContentItem[] = []
  for (const id of platforms) {
    const p = platformInfo(id)
    const mine = pb.content.filter(c => c.platform === id)
    if (mine.length) { out.push(...mine.map(c => ({ platform: p.label, item: c.item, cadence: c.cadence }))); continue }
    if (id === 'youtube_organic') out.push({ platform: p.label, item: 'Vídeo largo con miniatura y título A/B', cadence: '1–2 por semana (orientativo)' }, { platform: p.label, item: 'Shorts que lleven al vídeo largo', cadence: '3–5 por semana (orientativo)' })
    else if (id === 'instagram_organic') out.push({ platform: p.label, item: 'Reels y carruseles con una idea por pieza', cadence: '3–4 por semana (orientativo)' })
    else if (id === 'tiktok_organic') out.push({ platform: p.label, item: 'Vídeos verticales cortos con el gancho en el primer segundo', cadence: '4–7 por semana (orientativo)' })
    else out.push({ platform: p.label, item: `${p.formats[0]}: 3 variantes de gancho y 2 llamadas a la acción`, cadence: 'Todas desde el primer día; se retiran las peores en la fase de optimización' })
  }
  return out
}

function creativesOf(b: Brief, platforms: PlatformId[], pb: Playbook): Creative[] {
  const proj = (href: string) => (b.projectId ? `${href}?project=${encodeURIComponent(b.projectId)}` : href)
  const langs = [...new Set(b.countries.map(c => COUNTRIES.find(x => x.code === c)?.language).filter(Boolean))]
  const langNote = langs.length ? ` Idioma de las piezas: ${langs.join(', ')} (uno por mercado).` : ''
  const has = (...ids: PlatformId[]) => platforms.filter(p => ids.includes(p)).map(p => platformInfo(p).label)
  const vertical = has('instagram_organic', 'tiktok_organic', 'meta_ads', 'tiktok_ads')
  const list: Creative[] = [
    { title: 'Guion corto con gancho, desarrollo y llamada a la acción', spec: `Hasta 3 variantes de gancho (primeros 3 segundos) para probar.${langNote}`, platforms: platforms.map(p => platformInfo(p).label), studioHref: proj('/scripts'), studioLabel: 'Abrir Guiones' },
  ]
  if (vertical.length) list.push({ title: 'Vídeo vertical 9:16', spec: 'Formato vertical a pantalla completa; consulta la duración y los márgenes seguros vigentes de cada plataforma antes de exportar.', platforms: vertical, studioHref: proj('/repurpose'), studioLabel: 'Convertir a vertical' })
  if (has('youtube_organic', 'google_ads').length) list.push({ title: 'Vídeo horizontal 16:9 y miniatura', spec: 'Miniatura 16:9 con 2 variantes (A/B).', platforms: has('youtube_organic', 'google_ads'), studioHref: proj('/thumbnails'), studioLabel: 'Crear miniaturas' })
  list.push({ title: 'Montaje, voz y música', spec: 'Montaje con subtítulos; voz y música con licencia registrada en la Biblioteca.', platforms: platforms.map(p => platformInfo(p).label), studioHref: proj('/editor'), studioLabel: 'Abrir Editor' })
  if (platforms.some(p => platformInfo(p).kind === 'paid')) list.push({ title: 'Textos de anuncio y página de destino', spec: '2 titulares y 2 descripciones por variante; el enlace lleva UTM.', platforms: has('google_ads', 'meta_ads', 'tiktok_ads'), studioHref: b.projectId ? `/projects/${encodeURIComponent(b.projectId)}` : '/projects', studioLabel: b.projectId ? 'Abrir el proyecto' : 'Ver proyectos' })
  for (const c of pb.creatives) {
    const mine = c.platforms.filter(x => platforms.includes(x))
    if (mine.length && !list.some(x => x.title === c.title)) list.push({ title: c.title, spec: `${c.spec}${langNote}`, platforms: mine.map(x => platformInfo(x).label), studioHref: proj(c.studioHref), studioLabel: c.studioLabel })
  }
  return list
}

function audienceOf(b: Brief, pb: Playbook): Strategy['audience'] {
  const markets = b.countries.map(c => { const k = COUNTRIES.find(x => x.code === c); return k ? `${k.name} (idioma principal: ${k.language})` : c })
  const demographics = b.ageMin !== null || b.ageMax !== null ? `${b.ageMin ?? 13}–${b.ageMax ?? '65+'} años` : 'Sin definir'
  const interests = b.interests.split(/[,;\n]/).map(x => x.trim()).filter(Boolean)
  const segments: Segment[] = [
    { name: 'Núcleo', description: interests.length ? `Personas interesadas en ${interests.slice(0, 5).join(', ')}${b.audienceNotes ? `. ${b.audienceNotes}` : ''}` : (b.audienceNotes || 'Define intereses para poder segmentar.'), requires: 'Solo los datos de este brief.' },
    { name: 'Búsqueda activa', description: 'Personas que ya buscan el tema (palabras clave de Investigación).', requires: 'Palabras clave de la pestaña «Palabras clave» de Investigación.' },
    { name: 'Reorientación', description: 'Quien ya vio tus vídeos o visitó tu web.', requires: 'Seguimiento instalado (píxel / lista de audiencia) y volumen suficiente; no existe el primer día.' },
  ]
  return { demographics, markets, segments: [...segments, ...pb.segments] }
}

function scenariosOf(b: Brief, platforms: PlatformId[], budget: BudgetPlan): { set: ScenarioSet | null; note: string } {
  const paid = platforms.filter(p => platformInfo(p).kind === 'paid')
  if (!b.goal) return { set: null, note: 'Elige un objetivo para estimar escenarios.' }
  if (!paid.length) return { set: null, note: 'Sin plataformas de pago no hay base numérica: el resultado orgánico depende de tu constancia y de tu audiencia previa. Fija hitos (piezas publicadas por semana) y mide.' }
  if (b.totalBudget === 0) return { set: null, note: 'El presupuesto total es 0 pero hay plataformas de pago: sube el presupuesto o quita las plataformas de pago.' }
  if (!budget.lines.length) return { set: null, note: 'Falta el presupuesto total para calcular escenarios.' }
  const variants: Array<[Scenario['name'], number, number, number]> = [['Conservador', 1.3, 0.7, 0.6], ['Base', 1, 1, 1], ['Optimista', 0.8, 1.3, 1.4]]
  const FREQUENCY = 2
  const scenarios: Scenario[] = variants.map(([name, cpmF, ctrF, convF]) => {
    let spend = 0, impressions = 0, clicks = 0, results = 0
    for (const line of budget.lines) {
      const a = assumptionFor(b, line.platform)
      const imp = line.amount / Math.max(a.cpm * cpmF, 0.01) * 1000, clk = imp * a.ctr * ctrF
      spend += line.amount; impressions += imp; clicks += clk
      // A view or an interaction is a share of IMPRESSIONS, never of clicks; only subscribers, leads and sales are shares of clicks.
      results += b.goal === 'awareness' ? imp / FREQUENCY : IMPRESSION_BASED.has(b.goal!) ? imp * Math.min(a.rate * convF, 1) : clk * Math.min(a.conversion * convF, 1)
    }
    const r = Math.round(results)
    return { name, spend: round2(spend), impressions: Math.round(impressions), clicks: Math.round(clicks), results: r, costPerResult: r > 0 ? round2(spend / r) : null, pctOfGoal: b.expectedValue && sameMetric(b) ? Math.round((r / b.expectedValue) * 100) : null }
  })
  const metric = METRICS.find(m => m[0] === GOAL_METRIC[b.goal!])?.[1] ?? 'Resultados'
  return { set: { metricLabel: metric, assumptions: paid.map(p => { const a = assumptionFor(b, p); return { id: p, platform: platformInfo(p).label, cpm: a.cpm, ctr: a.ctr, conversion: a.conversion, rate: a.rate, basis: (IMPRESSION_BASED.has(b.goal!) ? 'impresiones' : 'clics') as 'clics' | 'impresiones', custom: a.custom } }), scenarios,
    note: `Cálculo: gasto ÷ CPM × 1000 = impresiones; × CTR = clics; ${b.goal === 'awareness' ? 'alcance = impresiones ÷ frecuencia 2' : IMPRESSION_BASED.has(b.goal!) ? `${GOAL_METRIC[b.goal!] === 'views' ? 'visualizaciones' : 'interacciones'} = impresiones × tasa (no son clics)` : 'resultados = clics × conversión'}. Conservador / Base / Optimista varían CPM, CTR y conversión. Los supuestos son ejemplos editoriales, NO datos medidos: cámbialos con los de un piloto real.` }, note: '' }
}

function rulesOf(b: Brief, budget: BudgetPlan, set: ScenarioSet | null, mode: Mode | null, pb: Playbook): Rule[] {
  const cur = b.currency, paid = mode === 'paid' || mode === 'mixed', organic = mode === 'organic' || mode === 'mixed' || mode === null
  const fromGoal = b.totalBudget && b.expectedValue && b.expectedValue > 0 && sameMetric(b) ? round2(b.totalBudget / b.expectedValue) : null
  const target = fromGoal ?? set?.scenarios[1].costPerResult ?? null
  // Never a rule that refers to «0» or divides by it: with no positive cost target the text says «tu coste objetivo».
  const t = target !== null && Number.isFinite(target) && target > 0 ? money(target, cur) : 'tu coste objetivo por resultado'
  const metric = b.goal ? METRIC_ONE[GOAL_METRIC[b.goal]] : 'resultado'
  const test = budget.phases[0] ? money(budget.phases[0].amount, cur) : 'el presupuesto de prueba'
  const rules: Rule[] = []
  const pushAll = (scope: Rule['scope'], ...rs: Array<Omit<Rule, 'scope'>>) => { rules.push(...rs.map(r => ({ ...r, scope }))) }
  if (paid) pushAll('pago',
    { kind: 'detener', when: `has gastado ${test} (la fase de prueba) y no hay ningún resultado atribuido (${metric}), o el coste por ${metric} supera 2 × ${t}.`, then: 'Pausa esa creatividad o ese público; no reinviertas hasta cambiar el gancho o el destino.' },
    { kind: 'detener', when: 'una plataforma o política rechaza el anuncio, o aparecen comentarios de derechos o de engaño.', then: 'Pausa de inmediato y corrige la pieza antes de reactivar.' },
    { kind: 'optimizar', when: 'el CTR está por debajo del 60 % del supuesto con al menos 1.000 impresiones.', then: 'Cambia el gancho de los primeros 3 segundos o la miniatura; el problema está en la creatividad.' },
    { kind: 'optimizar', when: 'hay clics pero el resultado final no llega (coste por resultado > 1,5 × objetivo).', then: 'Revisa la página o el vídeo de destino, la velocidad de carga y la coherencia con el anuncio.' },
    { kind: 'ampliar', when: `el coste por ${metric} es ≤ ${t} durante 3 días seguidos con al menos 30 resultados.`, then: 'Sube el presupuesto de esa combinación un 20 % cada 3 días como máximo, y duplica la variante ganadora en otro público.' },
    { kind: 'ampliar', when: 'dos creatividades superan el objetivo en el mercado piloto.', then: 'Prueba el mismo anuncio en un segundo mercado con su idioma y su presupuesto propios.' },
  )
  // Organic: the only thing invested is time, so nothing here asks for money.
  if (organic) pushAll('orgánico',
    { kind: 'detener', when: 'un formato o una serie lleva 8–10 publicaciones y casi todas quedan por debajo de tu mediana de visualizaciones y de retención', then: 'Retira ese formato y dedica ese tiempo a otro; no insistas por insistir.' },
    { kind: 'detener', when: 'una pieza recibe una reclamación de derechos o un aviso de política', then: 'Retírala o corrígela de inmediato y revisa las demás con el mismo material.' },
    { kind: 'optimizar', when: 'una pieza tiene buena retención pero pocas impresiones o poco CTR', then: 'Cambia título y miniatura (o el primer segundo); el contenido ya funciona.' },
    { kind: 'optimizar', when: 'las piezas se abandonan en los primeros segundos', then: 'Reescribe el gancho antes de cambiar el tema.' },
    { kind: 'ampliar', when: 'dos o tres piezas seguidas superan tu mediana de visualizaciones o de retención', then: 'Publica más de ese formato (más cadencia con el mismo esfuerzo) y adáptalo a otra plataforma orgánica.' },
  )
  for (const r of pb.rules) if (!r.paid || paid) pushAll(r.paid ? 'pago' : 'ambos', { kind: r.kind, when: r.when, then: r.then })
  return dedupeRules(rules)
}

const ruleTokens = (r: Pick<Rule, 'when' | 'then'>) => new Set(`${r.when} ${r.then}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 3))
/** A mixed campaign collects rules from the paid set, the organic set and the project kind: drop the ones that say the same thing (same kind, ≥ 50 % of their words shared). */
export function dedupeRules(rules: Rule[]): Rule[] {
  const kept: Array<{ rule: Rule; tokens: Set<string> }> = []
  for (const rule of rules) {
    const tokens = ruleTokens(rule)
    const dup = kept.find(k => k.rule.kind === rule.kind && (k.rule.when === rule.when || [...tokens].filter(t => k.tokens.has(t)).length / Math.max(Math.min(tokens.size, k.tokens.size), 1) >= 0.5))
    if (dup) { if (dup.rule.scope !== rule.scope) dup.rule = { ...dup.rule, scope: 'ambos' }; continue }
    kept.push({ rule, tokens })
  }
  return kept.map(k => k.rule)
}

/** Compares the stated goal with what the budget buys in the scenarios. The goal is a wish; the scenarios are an estimate from example assumptions. */
function feasibilityOf(b: Brief, set: ScenarioSet | null, mode: Mode | null): Feasibility {
  const diff = 'El objetivo es lo que quieres conseguir; los escenarios son lo que el presupuesto compra con supuestos de ejemplo (no medidos). Si no coinciden, cambia el objetivo, el presupuesto o los supuestos con datos de un piloto.'
  if (!b.goal || !b.expectedValue || b.expectedValue <= 0 || b.expectedMetric === null) return { state: 'sin_base', headline: 'Sin objetivo numérico', detail: `Indica una métrica y una cantidad para poder compararlas con los escenarios. ${diff}`, budgetForGoal: null }
  if (!sameMetric(b)) return { state: 'no_comparable', headline: 'Objetivo y escenarios en unidades distintas', detail: `El objetivo se mide en ${METRICS.find(m => m[0] === b.expectedMetric)?.[1].toLowerCase()} y los escenarios en ${METRICS.find(m => m[0] === GOAL_METRIC[b.goal!])?.[1].toLowerCase()}: no se pueden comparar.`, budgetForGoal: null }
  if (!set) return { state: 'sin_base', headline: mode === 'organic' ? 'Objetivo orgánico: sin estimación numérica' : 'Sin escenarios con los datos actuales', detail: mode === 'organic' ? `Sin medios de pago no hay base para estimar resultados con estos supuestos: compara el objetivo con tus resultados anteriores (por ejemplo, lo que han hecho tus últimas 10 publicaciones) y fija hitos por semana. ${diff}` : `Falta presupuesto o plataforma de pago para calcular escenarios. ${diff}`, budgetForGoal: null }
  const [cons, base, opt] = set.scenarios, goal = b.expectedValue, f = (n: number) => n.toLocaleString('es-ES')
  const need = base.costPerResult !== null && base.costPerResult > 0 ? Math.round(base.costPerResult * goal) : null
  const line = `Estimación de ${set.metricLabel.toLowerCase()}: conservador ${f(cons.results)}, base ${f(base.results)}, optimista ${f(opt.results)}; tu objetivo: ${f(goal)}. ${need !== null ? `Al coste por resultado del escenario base harían falta ≈ ${f(need)} ${b.currency} para llegar a tu objetivo (tienes ${f(b.totalBudget ?? 0)}). ` : ''}${diff}`
  if (goal <= cons.results) return { state: 'realista', headline: 'Realista: se alcanza incluso en el escenario conservador', detail: line, budgetForGoal: need }
  if (goal <= base.results) return { state: 'realista', headline: 'Realista: se alcanza en el escenario base', detail: line, budgetForGoal: need }
  if (goal <= opt.results) return { state: 'ambicioso', headline: 'Ambicioso: solo se alcanza si todo sale mejor de lo esperado (escenario optimista)', detail: line, budgetForGoal: need }
  return { state: 'poco_realista', headline: goal > 3 * opt.results ? 'Poco realista: muy por encima incluso del escenario optimista' : 'Poco realista: supera el escenario optimista', detail: line, budgetForGoal: need }
}

export function buildStrategy(b: Brief, now = Date.now()): Strategy {
  const questions = questionsOf(b), answered = questions.filter(q => q.done).length
  const kind = kindOf(b), pb = PLAYBOOKS[kind.kind]
  const chosen = effectivePlatforms(b)
  const platforms = rankPlatforms(b).map(p => ({ ...p, chosen: chosen.includes(p.id) }))
  const mode = modeOf(chosen)
  const days = b.durationDays
  const budget = budgetOf(b, chosen, days)
  const { set, note } = scenariosOf(b, chosen, budget)
  const suggestions: string[] = []
  const subjectOk = questions[0].done
  if (!subjectOk) suggestions.push('Indica qué promocionas y su nombre: el informe y las creatividades se basan en ello.')
  if (!b.goal) suggestions.push(pb.goals.length ? `Elige un objetivo principal. Para «${pb.label}» suele encajar: ${pb.goals.map(g => label(GOALS, g as Goal)).join(' o ')}.` : 'Elige un objetivo principal. Para un canal nuevo suele ser «Suscriptores» o «Visualizaciones»; para una tienda, «Ventas» o «Visitas».')
  if (!b.countries.length) suggestions.push('Elige 1–3 países. Investigación te dice dónde hay demanda y poca competencia: usa «Planificar campaña» desde un análisis.')
  if (!b.platforms.length && b.goal) suggestions.push(`Plataformas sugeridas para tu objetivo: ${chosen.map(p => platformInfo(p).label).join(', ')}. Pulsa «Usar sugeridas» para fijarlas.`)
  if (b.totalBudget === 0) suggestions.push(mode === 'organic' ? 'Presupuesto 0: campaña orgánica. Tu inversión es tiempo, no dinero: fija cuántas piezas por semana puedes producir y mide con los indicadores de abajo. No se recomienda gastar.' : 'Presupuesto 0 con plataformas de pago: quita las plataformas de pago o indica un presupuesto.')
  if (b.totalBudget === null) suggestions.push(budget.pilotBudget ? `Sin presupuesto: un piloto de aprendizaje (10 por día y plataforma de pago durante 14 días) sería de ${money(budget.pilotBudget, b.currency)}. Es una guía, no un mínimo oficial.` : 'Indica el presupuesto total (0 si solo es orgánica).')
  if (budget.suggestedDailyCap) suggestions.push(`Presupuesto diario máximo sugerido: ${money(budget.suggestedDailyCap, b.currency)} (total ÷ duración + 25 % de margen).`)
  if (budget.suggestedDays && b.durationDays === null) suggestions.push(`Duración sugerida para este objetivo: ${budget.suggestedDays} días.`)
  if (b.expectedValue === null && b.goal) suggestions.push('Define una cifra de resultado esperada: sin ella el sistema usa el coste por resultado del escenario base como referencia.')
  if (!b.interests.trim() && !b.audienceNotes.trim() && b.ageMin === null) suggestions.push('Describe al público: edad, intereses y un problema concreto que resuelves.')
  const warnings = [...budget.warnings, ...pb.warnings]
  if (pb.paid === 'desaconsejado' && chosen.some(p => platformInfo(p).kind === 'paid') && b.platforms.length) warnings.push(`Has elegido plataformas de pago, pero para «${pb.label}» no suelen compensar: si las mantienes, limítalas a una prueba pequeña (no más del 20 % del presupuesto) y compara con el resultado orgánico.`)
  if (days !== null && days < 7) warnings.push('Con menos de 7 días no hay tiempo de probar, optimizar y escalar: el calendario se reduce a lanzar y medir, y los resultados serán ruido.')
  if (b.totalBudget === 0 && (mode === 'paid' || mode === 'mixed')) warnings.push('Presupuesto 0 con plataformas de pago: no habrá gasto en medios. Sube el presupuesto o quita las plataformas de pago.')
  if (b.goal && b.expectedMetric && b.expectedValue !== null && !sameMetric(b)) warnings.push(`El objetivo «${label(GOALS, b.goal)}» se mide en ${METRICS.find(m => m[0] === GOAL_METRIC[b.goal!])?.[1].toLowerCase()} y esperas ${METRICS.find(m => m[0] === b.expectedMetric)?.[1].toLowerCase()}: no se comparan los escenarios con esa cifra.`)
  if (b.startDate && !validDate(b.startDate)) warnings.push('La fecha de inicio no es una fecha válida (AAAA-MM-DD): el calendario se muestra por días, sin fechas.')
  else if (b.startDate && Date.parse(`${b.startDate}T00:00:00Z`) < startOfUtcDay(now)) warnings.push('La fecha de inicio ya ha pasado.')
  if (b.goal === 'sales' && (mode === 'paid' || mode === 'mixed')) warnings.push('Sin seguimiento de conversiones (píxel / API de conversiones) las plataformas no pueden optimizar ventas.')
  if (b.countries.length > 3) warnings.push('Más de 3 países dispersa el presupuesto: empieza por 1–2 y amplía.')
  const subj = b.subjectName.trim() || label(SUBJECTS, b.subject).toLowerCase() || 'tu proyecto'
  const summary = `Campaña ${mode === 'mixed' ? 'mixta (orgánica + pago)' : mode === 'paid' ? 'de pago' : mode === 'organic' ? 'orgánica' : '(sin modalidad definida)'} para ${subj}${b.goal ? ` con el objetivo «${label(GOALS, b.goal)}»` : ''}${b.countries.length ? ` en ${b.countries.map(countryName).join(', ')}` : ''}${days ? `, durante ${days} días` : ''}${b.totalBudget !== null ? `, con ${money(b.totalBudget, b.currency)} de presupuesto` : ''}.`
  const kpiList = chosen.flatMap(p => kpisFor(p, b.goal))
  const hasPaid = mode === 'paid' || mode === 'mixed'
  const kpiOptions = [...new Set([...kpiList, ...pb.kpis.filter(k => hasPaid || !COST_KPI.test(k)), ...(b.kpis ?? [])])]
  const chosenKpis = b.kpis.length ? b.kpis : kpiOptions
  return {
    origin: b.source?.summary ?? null, kind: { id: kind.kind, label: pb.label, blurb: pb.blurb, inferred: kind.inferred }, feasibility: feasibilityOf(b, set, mode), kpiOptions, chosenKpis,
    mode, answered, questions, suggestions, summary, platforms, audience: audienceOf(b, pb), content: contentOf(b, chosen, pb), creatives: creativesOf(b, chosen, pb), budget,
    calendar: calendarOf(b, days, mode, pb), kpis: chosen.map(p => ({ platform: platformInfo(p).label, kpis: kpisFor(p, b.goal) })),
    scenarios: set, scenarioNote: note, rules: rulesOf(b, budget, set, mode, pb), warnings,
  }
}
