import { isPublicHttpsUrl } from '@/lib/providers/safe-url'
import { normalize } from './topics'

/**
 * A Short needs a verifiable fact backed by at least two reliable sources, or it is discarded.
 * The model only PROPOSES sources; code decides: each source must be on a reliable domain, must be reachable,
 * and its page must actually contain the key terms of the fact. Two different domains must pass.
 */

export const MIN_SOURCES = 2

const RELIABLE_SUFFIXES = ['gov', 'edu', 'int', 'mil'] as const
const RELIABLE_DOMAINS = [
  'nasa.gov', 'esa.int', 'who.int', 'un.org', 'unesco.org', 'cern.ch', 'noaa.gov', 'nih.gov', 'usgs.gov', 'cdc.gov', 'si.edu', 'csic.es', 'ine.es', 'nature.com', 'science.org', 'sciencedirect.com', 'pnas.org', 'cell.com', 'thelancet.com', 'bmj.com',
  'scientificamerican.com', 'nationalgeographic.com', 'smithsonianmag.com', 'britannica.com', 'bbc.com', 'bbc.co.uk', 'reuters.com', 'apnews.com', 'elpais.com', 'wikipedia.org', 'newscientist.com', 'nationalgeographic.es',
] as const

/** example.co.uk-style hosts keep three labels; everything else keeps the last two. */
export function registrableDomain(host: string) {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.')
  if (labels.length >= 3 && /^(co|com|ac|gov|org|edu)$/.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2) return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

export type Reliability = { reliable: boolean; domain: string; reason: string }

export function sourceReliability(url: string, extra: string[] = []): Reliability {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return { reliable: false, domain: '', reason: 'URL no válida.' } }
  const domain = registrableDomain(host)
  const tld = host.split('.').pop() ?? ''
  const labels = host.split('.')
  const academic = labels.length >= 3 && /^(ac|edu|gov)$/.test(labels[labels.length - 2])
  if (extra.includes(domain)) return { reliable: true, domain, reason: 'Dominio añadido a la lista de fiables.' }
  if ((RELIABLE_DOMAINS as readonly string[]).includes(domain)) return { reliable: true, domain, reason: 'Institución, revista científica, enciclopedia o agencia de noticias reconocida.' }
  if ((RELIABLE_SUFFIXES as readonly string[]).includes(tld) || academic) return { reliable: true, domain, reason: 'Dominio institucional o académico.' }
  return { reliable: false, domain, reason: 'Dominio sin clasificar como fiable (añádelo en la configuración si lo es).' }
}

export type ProposedSource = { url: string; title: string }
export type FetchedPage = { ok: boolean; status?: number; text: string }
export type SourceVerdict = { url: string; title: string; domain: string; status: 'accepted' | 'rejected'; reason: string; excerpt?: string }

/** Plain text of an HTML page, capped so a huge page cannot flood the verification prompt. */
export function htmlToText(html: string, max = 6000) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Comparable form: lowercase, no accents, thousands separators removed from numbers ("330.000" = "330000"). */
export function comparable(s: string) {
  return normalize(s).replace(/(\d)[.,\s](?=\d{3}\b)/g, '$1').replace(/\s+/g, ' ')
}

/** Share of the key terms found in the text (0–1). */
export function keyTermCoverage(text: string, keyTerms: string[]) {
  const hay = comparable(text)
  const terms = keyTerms.map(comparable).filter(Boolean)
  if (!terms.length) return 0
  return terms.filter(t => hay.includes(t)).length / terms.length
}

export const MIN_COVERAGE = 0.5

/**
 * Checks each proposed source. `fetchPage` is injected (real one: fetchPublicPage). At most `limit` sources are fetched.
 * The fact passes when ≥ MIN_SOURCES accepted sources are on different domains.
 */
export async function assessSources(proposed: ProposedSource[], keyTerms: string[], fetchPage: (url: string) => Promise<FetchedPage>, opts: { extraReliable?: string[]; limit?: number } = {}) {
  const verdicts: SourceVerdict[] = []
  const acceptedDomains = new Set<string>()
  for (const s of proposed.slice(0, opts.limit ?? 5)) {
    const base = { url: s.url, title: s.title.slice(0, 160) }
    if (!isPublicHttpsUrl(s.url)) { verdicts.push({ ...base, domain: '', status: 'rejected', reason: 'No es una dirección HTTPS pública.' }); continue }
    const rel = sourceReliability(s.url, opts.extraReliable)
    if (!rel.reliable) { verdicts.push({ ...base, domain: rel.domain, status: 'rejected', reason: rel.reason }); continue }
    if (acceptedDomains.has(rel.domain)) { verdicts.push({ ...base, domain: rel.domain, status: 'rejected', reason: 'Mismo dominio que otra fuente ya aceptada: cuenta una sola vez.' }); continue }
    let page: FetchedPage
    try { page = await fetchPage(s.url) } catch { page = { ok: false, text: '' } }
    if (!page.ok) { verdicts.push({ ...base, domain: rel.domain, status: 'rejected', reason: `No se pudo abrir la página${page.status ? ` (${page.status})` : ''}: una fuente que no se puede comprobar no cuenta.` }); continue }
    const coverage = keyTermCoverage(page.text, keyTerms)
    if (coverage < MIN_COVERAGE) { verdicts.push({ ...base, domain: rel.domain, status: 'rejected', reason: `La página no contiene el dato (aparecen ${Math.round(coverage * 100)}% de los términos clave).` }); continue }
    acceptedDomains.add(rel.domain)
    verdicts.push({ ...base, domain: rel.domain, status: 'accepted', reason: `${rel.reason} Contiene el dato (${Math.round(coverage * 100)}% de los términos clave).`, excerpt: page.text.slice(0, 1200) })
  }
  const accepted = verdicts.filter(v => v.status === 'accepted')
  return { verdicts, accepted, ok: acceptedDomains.size >= MIN_SOURCES }
}

/**
 * Reads a public page for verification. HTTPS only, no credentials, redirects followed by hand (each hop is re-checked),
 * 8 s timeout and a 600 kB cap so a slow or huge response cannot hold the job.
 */
export async function fetchPublicPage(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedPage> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublicHttpsUrl(current)) return { ok: false, text: '' }
    const r = await fetchImpl(current, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'CerebroStudio-FactCheck/1.0', Accept: 'text/html,text/plain' } })
    if (r.status >= 300 && r.status < 400) {
      const next = r.headers.get('location')
      if (!next) return { ok: false, status: r.status, text: '' }
      try { current = new URL(next, current).toString() } catch { return { ok: false, text: '' } }
      continue
    }
    if (!r.ok) return { ok: false, status: r.status, text: '' }
    const type = (r.headers.get('content-type') ?? '').toLowerCase()
    if (type && !/text\/(html|plain)|application\/xhtml/.test(type)) return { ok: false, status: r.status, text: '' }
    const buf = new Uint8Array(await r.arrayBuffer())
    return { ok: true, status: r.status, text: htmlToText(new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, 600_000))) }
  }
  return { ok: false, text: '' }
}
