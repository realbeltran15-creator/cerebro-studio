import type { Currency } from './types'

/** Currency people budget in for each market. A campaign aimed at the United Kingdom is budgeted in pounds unless the person says otherwise. */
const BY_COUNTRY: Record<string, Currency> = {
  GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', CH: 'CHF',
  DE: 'EUR', ES: 'EUR', FR: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', IE: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR',
}
export const CURRENCY_NAME: Record<Currency, string> = { EUR: 'euros', USD: 'dólares estadounidenses', GBP: 'libras esterlinas', CHF: 'francos suizos', CAD: 'dólares canadienses', AUD: 'dólares australianos' }

/** The one currency the chosen countries share, or null when there is none (no countries, unknown countries or several currencies). */
export function currencyForCountries(countries: string[]): Currency | null {
  const set = new Set(countries.map(c => BY_COUNTRY[c]).filter((c): c is Currency => !!c))
  return set.size === 1 ? [...set][0] : null
}

/** A mismatch worth telling: every chosen country uses another single currency than the one the budget is in. */
export function currencyMismatch(countries: string[], currency: Currency): Currency | null {
  const suggested = currencyForCountries(countries)
  const known = countries.filter(c => BY_COUNTRY[c]).length
  return suggested && known === countries.length && suggested !== currency ? suggested : null
}
