# «Failed to fetch» en `/api/research/topic` · diagnóstico real · 17-10-2026

## Causa demostrada

La Preview está protegida con **Vercel Authentication (Standard Protection)**. Lo he comprobado en Vercel → `cerebro-studio` → Settings → Deployment Protection → «Require Log In».

Cuando el navegador no envía una cookie válida de Vercel (`_vercel_jwt`), ocurre lo siguiente:

1. La plataforma corta la petición `fetch('/api/research/topic…')` **antes de que llegue a la función**.
2. Responde con una **redirección** al inicio de sesión de vercel.com, que es otro dominio.
3. `fetch` no puede seguir una redirección a otro dominio y lanza exactamente `TypeError: Failed to fetch`.

La cookie falta cuando:
- ha caducado;
- es otro navegador o perfil;
- el navegador o una extensión de privacidad la bloquea;
- la pestaña lleva mucho tiempo abierta.

**Reproducción sin gastar cuota.** La hice en la propia Preview, con la petición gratuita `cacheOnly=1` de «AI tools for beginners» · US · en:

| Petición | Resultado |
|---|---|
| `fetch(url, {cache:'no-store'})`, con cookie | `200` · `{"analysis":null,...}` |
| `fetch(url, {credentials:'omit'})`, sin cookie | **`TypeError: Failed to fetch`**, el mismo texto que ve el usuario |
| `fetch(url, {credentials:'omit', redirect:'manual'})` | `type: "opaqueredirect"`, `status: 0`: la redirección de la protección |

**Pruebas de que no es YouTube ni la función:**
- **Google Cloud** («Search Queries per day») marca **7/100** hoy, y esas 7 son de mis pruebas anteriores. La búsqueda fallida de «AI tools for beginners» nunca llegó a YouTube y **no gastó cuota**.
- Los **Request Logs de Vercel** (Preview) no tienen ninguna petición `GET /api/research/topic` en la ventana disponible, salvo mi prueba gratuita de las 14:54 (hora local), que dio 200. La petición fallida no llegó a la función.
  - Limitación: el plan Hobby solo guarda los logs alrededor de una hora, así que un intento anterior ya no aparecería.
- El endpoint funciona con la cookie: `/api/research/usage` y `/api/research/topic?cacheOnly=1` dan 200 en ~1–1,5 s.
- `maxDuration = 60` (c2b9275) es correcto, pero no tiene que ver con este error: un tiempo agotado da un 504, que es una respuesta, no un «Failed to fetch».

## Qué tiene que cambiar Claude Code

**`app/market-intelligence/research-context.tsx` → `paidFetch`, y el `POST` de crecimiento de la línea ~192:**
- Hacer las peticiones con `redirect: 'manual'`.
- Si `r.type === 'opaqueredirect'`, `r.status === 0` o `r.status === 401`, no tratarlo como fallo de red ni de YouTube. Mostrar:
  > «Tu sesión de acceso a esta versión de prueba ha caducado. Recarga la página (te pedirá entrar en Vercel) y vuelve a pulsar Analizar. No se ha gastado cuota.»
- No marcar consumo y no intentar la recuperación `cacheOnly`, que también sería redirigida.
- Aplicar lo mismo a `/api/research/usage` (hoy falla en silencio, `catch { /* offline */ }`), a `trending` y a `channel`.

**`isNetworkFailure` / `networkFailureMessage`:**
- Antes de culpar a la red, hacer una petición barata (`/api/research/usage`, con `redirect: 'manual'`).
- Si esa petición vuelve como `opaqueredirect`, el diagnóstico es «sesión de Vercel caducada», no «la conexión falló».

**Prueba de regresión:** simular `fetch` devolviendo `{ type: 'opaqueredirect', status: 0 }` y comprobar que:
- el mensaje es el de sesión caducada;
- no se suma consumo;
- no se reintenta.

## Alternativa de configuración (requiere decisión de Jesús)

Opciones en Vercel → Deployment Protection:
- **Desactivar Vercel Authentication solo en Preview.** La app ya exige iniciar sesión en Supabase (las API devuelven 401 sin usuario), pero la Preview quedaría visible públicamente.
- **Añadir el dominio de la rama** en «Deployment Protection Exceptions».

No he cambiado nada: es un cambio de permisos y necesita tu autorización.

## Arreglo inmediato para el usuario (sin código)

Recargar por completo la página de la Preview (F5). Vercel vuelve a pedir el inicio de sesión y crea una cookie nueva; después la búsqueda funciona.

Con la cookie válida, el endpoint responde 200 en este navegador.

## Observación aparte (P3)

`/api/research/topic` devuelve `usage.usedToday: 0` mientras `/api/research/usage` devuelve 714. Es otra instancia con el contador en memoria (`persistent:false`, falta `research_cache`). El navegador se queda con la cifra mayor, así que no es grave, pero confunde.
