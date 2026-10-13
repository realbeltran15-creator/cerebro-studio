/** Number formats for Investigación. es-ES leaves 4-digit numbers ungrouped (1022 vs 10.220), so grouping is forced to stay consistent. */
const num = new Intl.NumberFormat('es-ES', { useGrouping: 'always', maximumFractionDigits: 2 })
export const fmtNumber = (n: number) => num.format(n)
export const fmtUsd = (n: number) => `$${num.format(n)}`
/** Compact for big audience numbers: 1.200 → 1.200, 25.000 → 25 mil, 3.400.000 → 3,4 M. */
export const fmtCompact = (n: number) => (n >= 1_000_000 ? `${num.format(Math.round(n / 100_000) / 10)} M` : n >= 10_000 ? `${num.format(Math.round(n / 100) / 10)} mil` : num.format(Math.round(n)))
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
