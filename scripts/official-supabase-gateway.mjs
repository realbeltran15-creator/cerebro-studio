// Pasarela de rutas (sustituye a Kong del stack oficial). NO simula nada: solo reenvía, sin tocar cuerpos.
//   /auth/v1/*    -> GoTrue oficial     (AUTH_PORT,    por defecto 9999)
//   /rest/v1/*    -> PostgREST oficial  (REST_PORT,    por defecto 3000)
//   /storage/v1/* -> Storage API oficial (STORAGE_PORT, por defecto 5000)
// Añade CORS y las cabeceras X-Forwarded-* que el Storage usa para construir las URL de TUS.
import http from 'node:http'

const PORT = Number(process.env.GATEWAY_PORT || 54321)
const ROUTES = {
  '/auth/v1': Number(process.env.AUTH_PORT || 9999),
  '/rest/v1': Number(process.env.REST_PORT || 3000),
  '/storage/v1': Number(process.env.STORAGE_PORT || 5000),
}
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
  'access-control-max-age': '600',
}

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      return res.end()
    }
    const prefix = Object.keys(ROUTES).find((p) => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'))
    if (!prefix) {
      res.writeHead(404, { ...cors, 'content-type': 'application/json' })
      return res.end('{"message":"no route"}')
    }
    const headers = { ...req.headers, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http', 'x-forwarded-prefix': prefix } // Kong envía el prefijo; el Storage lo usa para las URL de TUS
    const up = http.request(
      { host: '127.0.0.1', port: ROUTES[prefix], method: req.method, path: req.url.slice(prefix.length) || '/', headers },
      (r) => {
        const out = { ...r.headers, ...cors }
        // El Storage en modo producción construye las URL de TUS con https; aquí no hay terminador TLS → se devuelven en http (única reescritura de la pasarela).
        if (typeof out.location === 'string') out.location = out.location.replace(/^https:\/\/(127\.0\.0\.1|localhost)/, 'http://$1')
        res.writeHead(r.statusCode, out)
        r.pipe(res)
      },
    )
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { ...cors, 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'upstream error', detail: String(e.message) }))
    })
    req.pipe(up)
  })
  .listen(PORT, '127.0.0.1', () => console.log(`gateway on ${PORT}`))
