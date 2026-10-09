import { generateJson } from './gemini'
import { hostnameOf, independentReliableSources, isPublicHttpUrl, quoteAppearsIn, registrableDomain, isReliableDomain } from './gates'
import type { FactoryConfig, Source } from './types'

const MAX_BYTES = 1_500_000

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
}

/** Descarga una página pública (sin seguir redirecciones a destinos privados). */
export async function fetchPageText(url: string): Promise<{ text: string; title?: string } | null> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublicHttpUrl(current)) return null
    let res: Response
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'CerebroStudioBot/1.0 (verificacion de fuentes)', accept: 'text/html,text/plain' },
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      })
    } catch { return null }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (!next) return null
      try { current = new URL(next, current).toString() } catch { return null }
      continue
    }
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/(html|plain)/i.test(type)) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    const html = new TextDecoder('utf-8').decode(buf.slice(0, MAX_BYTES))
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    return { text: htmlToText(html), title }
  }
  return null
}

type Judgement = { supports?: boolean; quote?: string }

/**
 * Una fuente solo cuenta si (1) es pública y de dominio fiable, (2) se descarga de verdad y
 * (3) contiene LITERALMENTE la cita que el modelo dice que respalda el dato. El modelo no puede inventar fuentes.
 */
export async function verifySources(claim: string, candidateUrls: string[], config: FactoryConfig, maxChecks = 5): Promise<{ sources: Source[]; checked: { url: string; ok: boolean; why: string }[] }> {
  const ordered = [...new Set(candidateUrls)].filter(u => {
    const h = hostnameOf(u)
    return h && isPublicHttpUrl(u) && isReliableDomain(registrableDomain(h), config.reliableDomains)
  })
  const sources: Source[] = []
  const checked: { url: string; ok: boolean; why: string }[] = []
  const domains = new Set<string>()
  for (const url of ordered) {
    if (checked.length >= maxChecks) break
    const domain = registrableDomain(hostnameOf(url)!)
    if (domains.has(domain)) { checked.push({ url, ok: false, why: 'dominio repetido' }); continue }
    const page = await fetchPageText(url)
    if (!page || page.text.length < 200) { checked.push({ url, ok: false, why: 'no se pudo descargar o sin texto' }); continue }
    const judged = await generateJson<Judgement>(
      `Eres un verificador estricto. AFIRMACIÓN: «${claim}»\n\nTEXTO DE LA PÁGINA (puede estar en otro idioma):\n"""${page.text.slice(0, 30_000)}"""\n\n` +
      `¿El texto respalda EXPLÍCITAMENTE la afirmación (mismos números y sentido)? Responde JSON {"supports": boolean, "quote": string}. ` +
      `"quote" debe ser una frase COPIADA LITERALMENTE del texto (25-300 caracteres). Si no la respalda o hay cifras distintas, supports=false y quote="".`,
      0,
    )
    if (judged.supports && judged.quote && quoteAppearsIn(page.text, judged.quote)) {
      domains.add(domain)
      sources.push({ url, domain, title: page.title, quote: judged.quote.trim(), verified_at: new Date().toISOString() })
      checked.push({ url, ok: true, why: 'cita literal encontrada' })
      if (independentReliableSources(sources, config.reliableDomains).length >= 2) break
    } else {
      checked.push({ url, ok: false, why: judged.supports ? 'la cita no aparece literalmente' : 'el texto no respalda el dato' })
    }
  }
  return { sources: independentReliableSources(sources, config.reliableDomains), checked }
}
