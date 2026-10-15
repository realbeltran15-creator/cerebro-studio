import { COUNTRIES } from '@/lib/research/discovery'
import { GOALS, SUBJECTS } from './catalog'
import { NETWORKS } from './connections'
import { buildStrategy } from './strategy'
import type { Brief } from './types'

const m = (n: number | null, c: string) => (n === null ? '—' : `${n.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${c}`)
const pct = (n: number) => `${(n * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`

/** Final report in Markdown: what was decided, what is an assumption, what is missing and what cannot be done yet. */
export function campaignReport(b: Brief, generatedAt = new Date().toISOString()): string {
  const s = buildStrategy(b), c = b.currency
  const L: string[] = []
  L.push(`# Campaña: ${b.name || b.subjectName || 'Sin título'}`, '', `_Generado por Cerebro Studio el ${generatedAt.slice(0, 10)}. Es un plan de trabajo: no se ha publicado ningún anuncio ni se ha gastado dinero._`, '', s.summary, '')
  L.push('## 1. Brief', '', ...s.questions.map(q => `${q.n}. **${q.question}** ${q.done ? q.answer : '_Sin responder._'}`), '')
  if (b.subjectUrl) L.push(`Enlace: ${b.subjectUrl}`, '')
  if (b.sourceTopic) L.push(`Origen: análisis de Investigación «${b.sourceTopic}».${b.source?.fetchedAt ? ` Datos del ${b.source.fetchedAt.slice(0, 10)}.` : ''}`, '')
  if (s.origin) L.push(`> ${s.origin}`, '')
  if (s.suggestions.length) L.push('## Pendiente de completar', '', ...s.suggestions.map(x => `- ${x}`), '')
  if (s.warnings.length) L.push('## Avisos', '', ...s.warnings.map(x => `- ⚠ ${x}`), '')
  L.push('## 2. Estrategia y plataformas', '', ...s.platforms.filter(p => p.chosen).flatMap(p => [`### ${p.label} (${p.kind === 'paid' ? 'pago' : 'orgánico'})`, ...p.reasons.map(r => `- ${r}`), `- Formatos: ${p.formats.join('; ')}.`, `- Necesita: ${p.needs}`, '']))
  L.push('## 3. Público', '', `- Edad: ${s.audience.demographics}`, `- Mercados: ${s.audience.markets.join('; ') || '—'}`, ...s.audience.segments.map(x => `- **${x.name}:** ${x.description} _Requiere: ${x.requires}_`), '')
  L.push('## 4. Contenido y anuncios', '', ...s.content.map(x => `- **${x.platform}:** ${x.item} — ${x.cadence}`), '', '### Piezas creativas (vinculadas al Estudio)', '', ...s.creatives.map(x => `- **${x.title}** (${x.platforms.join(', ')}): ${x.spec} → ${x.studioLabel} (${x.studioHref})`), '')
  L.push('## 5. Presupuesto', '', `Total: ${m(s.budget.total, c)} · Máximo diario: ${m(b.dailyCap, c)} · Duración: ${s.budget.days ?? '—'} días`, '')
  if (s.budget.lines.length) L.push('| Plataforma | Importe | % del total |', '|---|---:|---:|', ...s.budget.lines.map(x => `| ${x.label} | ${m(x.amount, c)} | ${x.pct} % |`), `| Reserva | ${m(s.budget.reserve, c)} | 10 % |`, '', '| Fase | Importe | % |', '|---|---:|---:|', ...s.budget.phases.map(x => `| ${x.name} | ${m(x.amount, c)} | ${x.pct} % |`), '')
  else L.push('_Sin reparto: falta presupuesto o plataformas de pago._', '')
  L.push('## 6. Calendario', '', ...s.calendar.flatMap(p => [`### ${p.name} (${p.fromDay < 1 ? `semana previa` : `día ${p.fromDay}${p.toDay !== p.fromDay ? `–${p.toDay}` : ''}`}${p.from ? ` · ${p.from}${p.to && p.to !== p.from ? ` a ${p.to}` : ''}` : ''})`, ...p.tasks.map(t => `- ${t}`), '']))
  L.push('## 7. Indicadores', '', `**A seguir:** ${s.chosenKpis.join(', ')}`, '', ...s.kpis.map(k => `- **${k.platform}:** ${k.kpis.join(', ')}`), '')
  L.push('## 8. Escenarios estimados', '')
  if (s.scenarios) L.push(`Resultado medido: **${s.scenarios.metricLabel}**.`, '', '| Escenario | Gasto | Impresiones | Clics | Resultados | Coste por resultado | % del objetivo |', '|---|---:|---:|---:|---:|---:|---:|', ...s.scenarios.scenarios.map(x => `| ${x.name} | ${m(x.spend, c)} | ${x.impressions.toLocaleString('es-ES')} | ${x.clicks.toLocaleString('es-ES')} | ${x.results.toLocaleString('es-ES')} | ${m(x.costPerResult, c)} | ${x.pctOfGoal === null ? '—' : `${x.pctOfGoal} %`} |`), '', 'Supuestos usados (ejemplos editoriales, NO medidos):', ...s.scenarios.assumptions.map(a => `- ${a.platform}: CPM ${m(a.cpm, c)}, CTR ${pct(a.ctr)}, conversión ${pct(a.conversion)}${a.custom ? ' (editado por ti)' : ''}`), '', s.scenarios.note, '')
  else L.push(s.scenarioNote, '')
  L.push('## 9. Cuándo detener, optimizar o ampliar', '', ...s.rules.map(r => `- **${r.kind.toUpperCase()}** — Si ${r.when} → ${r.then}`), '')
  L.push('## 10. Conexiones publicitarias', '', 'Ninguna conexión está activa: esta campaña se ha diseñado sin API. Para ejecutarla, créala manualmente en cada plataforma con este plan, o espera a que la integración esté autorizada.', '')
  for (const n of NETWORKS) if (b.platforms.length === 0 || b.platforms.includes(n.network)) L.push(`- **${n.label}** (${n.api}): ${n.requirements.map(r => r.step).join(' → ')}. Plazo: ${n.approvalTime}`)
  L.push('', '## Límites', '', '- Los escenarios usan supuestos de ejemplo, no resultados de tus cuentas.', '- Los encajes de plataforma y las cadencias son criterio editorial, no estudios.', '- Cerebro Studio no publica anuncios ni gasta presupuesto.', `- Objetivo: ${GOALS.find(g => g[0] === b.goal)?.[1] ?? '—'}; tipo: ${SUBJECTS.find(x => x[0] === b.subject)?.[1] ?? '—'}; países: ${b.countries.map(x => COUNTRIES.find(k => k.code === x)?.name ?? x).join(', ') || '—'}.`)
  return L.join('\n') + '\n'
}
export const campaignJson = (b: Brief) => JSON.stringify({ brief: b, strategy: buildStrategy(b) }, null, 2)
