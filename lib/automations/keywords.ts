/** Client-safe helpers shared by the Automatizaciones form and the server runner. */

/** Splits the comma-separated form input into the keyword list that is stored (trimmed, lowercased, unique). */
export function parseKeywords(input: string): string[] {
  return [...new Set(input.split(/[,;\n]/).map(k => k.trim().replace(/\s+/g, ' ').toLowerCase()).filter(k => k.length > 1))].slice(0, 20)
}

/** Config stored for a trend-watch automation, built only from what the form holds. */
export function trendWatchFormConfig(form: { region: string; categoryId: string; keywords: string; autoSave: boolean }) {
  return { region: form.region, categoryId: form.categoryId || null, keywords: parseKeywords(form.keywords), autoSave: form.autoSave }
}
