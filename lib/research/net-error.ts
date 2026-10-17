import type { ServerUsage } from './ledger'

/** A fetch that never got an HTTP answer (connection reset, blocked, offline, redirected cross-origin): the browser only says «Failed to fetch». */
export const isNetworkFailure = (e: unknown) => e instanceof TypeError || (e instanceof Error && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message))

/**
 * Explains a request that got no answer. `before`/`after` are the server's own day counters read around the failure (null when the server could not be
 * asked): they tell whether the lost request reached YouTube and spent quota, which decides whether retrying is safe.
 */
export function networkFailureMessage(before: ServerUsage | null, after: ServerUsage | null): string {
  const head = 'No se recibió respuesta del servidor (se cortó la conexión antes de terminar la consulta)'
  if (!after) return `${head} y tampoco se pudo comprobar el consumo. Comprueba tu conexión; no reintentes en bucle: espera unos segundos y mira el contador de cuota antes de volver a lanzarla.`
  if (!before) return `${head}. El servidor responde ahora, pero no se pudo saber si la consulta llegó a gastar cuota: consulta el contador de hoy (${after.usedToday} de ${after.cap} unidades) antes de reintentar.`
  // Without the persistent table each serverless instance counts on its own, so a lost request on another instance leaves no trace here.
  if (!after.persistent) return `${head}. No se puede comprobar si llegó a gastar cuota de YouTube (el contador del servidor aún no es persistente y puede ser otra instancia). Cuenta este intento como posible gasto de 204 unidades · 2 búsquedas y reintenta una sola vez.`
  const units = after.usedToday - before.usedToday, searches = (after.searchesToday ?? 0) - (before.searchesToday ?? 0)
  if (units <= 0 && searches <= 0) return `${head}. No se ha gastado cuota de YouTube: es seguro reintentar.`
  return `${head}, pero el servidor sí llegó a consultar YouTube (${units} unidades · ${searches} búsqueda${searches === 1 ? '' : 's'}). Reintentar puede volver a gastarlas: pulsa «Actualizar» solo si el resultado no aparece.`
}

/** The text for any failed request that has no server answer to read (growth, free-text search): never a bare «Failed to fetch». */
export function unansweredMessage(cost: string): string {
  return `No se recibió respuesta del servidor (se cortó la conexión antes de terminar). No se puede comprobar si llegó a gastar cuota (${cost}); reintenta una sola vez y mira el contador de uso antes de insistir.`
}
