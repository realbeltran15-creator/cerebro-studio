/**
 * Money vocabulary per language, written in each language (NOT translated from English): what a German, Spanish, French, Italian, Dutch or
 * Portuguese video about investing actually says. Words are folded (no accents, ß → ss). A cue only counts when the video is in that language,
 * so «depot», «bank» or «fonds» in an English title never confirm anything. German also builds compounds («Weltportfolio», «Vermögensaufbau»,
 * «ETF-Sparplan»), so its stems are searched inside long words as well.
 */
export const FINANCE_WORDS: Record<string, string[]> = {
  de: ['sparplan', 'sparplane', 'sparplaene', 'sparrate', 'sparen', 'ansparen', 'anlegen', 'anleger', 'geldanlage', 'kapitalanlage', 'investieren', 'investor', 'vermogen', 'vermoegen', 'vermogensaufbau', 'altersvorsorge', 'rente', 'rentenlucke', 'aktie', 'aktien', 'aktienmarkt', 'fonds', 'indexfonds', 'dividende', 'dividenden', 'rendite', 'zinsen', 'zinseszins', 'borse', 'boerse', 'depot', 'broker', 'neobroker', 'kurs', 'kurse', 'kosten', 'gebuhren', 'thesaurierend', 'ausschuttend', 'weltportfolio', 'portfolio', 'msci', 'ftse', 'steuer', 'steuern', 'freistellungsauftrag', 'sparer', 'trade republic', 'scalable', 'comdirect', 'finanzen', 'finanzielle freiheit', 'passives einkommen', 'crash', 'kapitalmarkt', 'wertpapier', 'wertpapiere', 'zertifikat'],
  es: ['ahorro', 'ahorrar', 'inversion', 'invertir', 'inversor', 'inversores', 'bolsa', 'acciones', 'fondos indexados', 'fondo indexado', 'fondos de inversion', 'cartera', 'dividendos', 'rentabilidad', 'plan de ahorro', 'plan de pensiones', 'jubilacion', 'broker', 'comisiones', 'patrimonio', 'interes compuesto', 'renta fija', 'renta variable', 'libertad financiera', 'indexado', 'indexada'],
  fr: ['epargne', 'epargner', 'investir', 'investissement', 'investisseur', 'bourse', 'actions', 'placement', 'placements', 'portefeuille', 'rendement', 'frais', 'dividendes', 'plan d epargne', 'assurance vie', 'retraite', 'courtier', 'patrimoine', 'interets composes', 'liberte financiere', 'tracker', 'fonds indiciel', 'fonds indiciels'],
  it: ['risparmio', 'risparmiare', 'investire', 'investimento', 'investimenti', 'investitore', 'borsa', 'azioni', 'portafoglio', 'rendimento', 'rendimenti', 'dividendi', 'piano di accumulo', 'pac', 'pensione', 'pensioni', 'commissioni', 'patrimonio', 'interesse composto', 'liberta finanziaria', 'fondo indicizzato', 'fondi indicizzati', 'obbligazioni'],
  nl: ['beleggen', 'belegger', 'beleggingen', 'beleggingsfonds', 'sparen', 'vermogen', 'vermogensopbouw', 'rendement', 'dividend', 'aandelen', 'pensioen', 'kosten', 'indexfonds', 'beurs', 'portefeuille', 'rente op rente', 'financiele vrijheid'],
  pt: ['investir', 'investimento', 'investimentos', 'investidor', 'poupanca', 'poupar', 'bolsa', 'acoes', 'carteira', 'rendimento', 'rentabilidade', 'dividendos', 'reforma', 'aposentadoria', 'corretora', 'patrimonio', 'juros compostos', 'liberdade financeira', 'fundos de indice', 'tesouro direto'],
}

/** German builds long compounds: these stems count when they appear anywhere inside a word of 8+ letters. */
const DE_COMPOUND_STEMS = ['portfolio', 'vermogen', 'vermoegen', 'sparplan', 'sparrate', 'aktien', 'fonds', 'rendite', 'dividende', 'altersvorsorge', 'geldanlage', 'kapitalanlage', 'zinseszins', 'borsen', 'depot', 'anleger']

const phrase = (text: string, w: string) => (w.includes(' ') || w.length >= 5 ? text.includes(` ${w}`) : text.includes(` ${w} `) || text.includes(` ${w}s `))

/** Money cues found in a folded text, counting only the languages the video is in. Duplicates are removed. */
export function financeCues(foldedText: string, langs: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const l of new Set(langs.filter((x): x is string => !!x).map(x => x.slice(0, 2).toLowerCase()))) {
    for (const w of FINANCE_WORDS[l] ?? []) if (phrase(foldedText, w)) out.add(w)
    if (l === 'de') for (const tok of foldedText.split(' ')) if (tok.length >= 8) for (const st of DE_COMPOUND_STEMS) if (tok.includes(st)) { out.add(`…${st}…`); break }
  }
  return [...out]
}

/** Flat list for the niche classifier (it is language-agnostic, so it takes the long, distinctive words only). */
export const FINANCE_NICHE_WORDS = [...new Set(Object.values(FINANCE_WORDS).flat().filter(w => w.length >= 6 && !['kosten', 'frais', 'kurse', 'crash', 'tracker', 'depot', 'bolsa', 'borse'].includes(w)))]
