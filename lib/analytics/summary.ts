/** Client-safe text for an Analytics import result: requested period vs days YouTube actually returned. */

export type ImportResult = { requestedDays?: number; days?: number; videos?: number; period?: { startDate: string; endDate: string }; dataRange?: { startDate: string; endDate: string } | null }

export function importSummary(j: ImportResult) {
  const asked = `Solicitados ${j.requestedDays ?? '?'} días (${j.period?.startDate} → ${j.period?.endDate}).`
  const got = j.dataRange ? ` YouTube devolvió ${j.days} días con datos (${j.dataRange.startDate} → ${j.dataRange.endDate}) y ${j.videos} vídeos.` : ` YouTube no devolvió datos diarios; ${j.videos} vídeos.`
  const lag = j.dataRange && j.period && j.dataRange.endDate < j.period.endDate ? ' Los últimos días aún no están procesados: YouTube Analytics suele tardar 2–3 días.' : ''
  return asked + got + lag
}
