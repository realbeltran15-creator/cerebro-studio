/**
 * Recurring terms across a set of titles. A CALCULATED signal, not a trend prediction:
 * it only counts how many titles in the current chart mention each term.
 */
const stopwords = new Set(`a al algo ante como con contra cual de del desde donde el ella ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas más me mi muy no nos o os para pero por que qué se sea ser si sin sobre son su sus te tu tus un una uno unos y ya yo
the a an and are as at be by for from has have how i in is it its my of on or our that the this to was we what when who why will with you your vs ft feat official video oficial music musica música full episode ep capitulo capítulo parte part trailer live en vivo new nuevo nueva`.split(/\s+/))

export type RecurringTerm = { term: string; titles: number }

export function recurringTerms(titles: string[], minTitles = 2, limit = 15): RecurringTerm[] {
  const counts = new Map<string, number>()
  for (const title of titles) {
    const words = new Set(
      title.toLowerCase().normalize('NFKC')
        .replace(/https?:\/\/\S+/g, ' ')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(w => w.length >= 3 && !stopwords.has(w) && !/^\d+$/.test(w)),
    )
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minTitles)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, n]) => ({ term, titles: n }))
}
