/** Bloqueo en memoria por clave: evita que dos peticiones simultáneas hagan el mismo trabajo (p. ej. transcribir dos veces el mismo audio en la misma instancia). */
const running = new Set<string>()

export async function withInflight<T>(key: string, fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  if (running.has(key)) return { busy: true }
  running.add(key)
  try { return { busy: false, value: await fn() } } finally { running.delete(key) }
}

export function inflightCount() { return running.size }
