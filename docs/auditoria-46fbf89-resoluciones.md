# Auditoría real del commit `46fbf89`: resoluciones

Rama `feat/creation-studio`. Todo se probó con datos SIMULADOS y una base PostgreSQL local desechable; no se ha lanzado ninguna búsqueda de YouTube, no se ha aplicado ninguna migración y no se ha tocado Producción.

## Archivo `0001-auditoria-navegador-46fbf89.patch`
No está accesible: no hay ningún archivo con ese nombre en el repositorio ni en ninguna rama remota, y esta sesión no comparte archivos con la de Claude Chat. **No se ha aplicado ningún parche.** Si se quiere usar, hay que subirlo al repositorio (p. ej. a `docs/`) o pegar su contenido; antes de aplicarlo se inspeccionará y se comprobará con `git apply --check` que no pisa trabajo reciente.

## Los ocho problemas

| # | Problema | Causa | Corrección | Pruebas |
|---|---|---|---|---|
| 1 | El contador de cuota se reiniciaba | `quotaDayStart` conservaba los milisegundos del instante (el formateador trabaja en segundos): el «inicio de día» variaba hasta 999 ms entre llamadas y la comparación `ledger.day === quotaDayStart()` fallaba | El inicio de día se calcula sobre segundos enteros; el contador del navegador guarda el día como **etiqueta de calendario** (fecha del Pacífico), no como marca de tiempo | `research-quota.test.ts` §1 (falla si se quita el redondeo) |
| 2 | Límite adicional de 100 búsquedas diarias | Solo se contaban unidades | Segundo límite (`searches`) junto al de unidades; **ninguno sustituye al otro**. Tope de la app por defecto 60 (`RESEARCH_DAILY_SEARCH_CAP`) | `research-quota.test.ts` §2 |
| 3 | Reservas atómicas para ambos límites | La comprobación de presupuesto no era atómica y el contador de búsquedas no existía | `reserve` comprueba y reserva **los dos límites** a la vez (función SQL con bloqueo consultivo, memoria y archivo); `settle` anota unidades y búsquedas reales; carrera real de 8 sesiones SQL en `scripts/test-migrations.sh` | §2 y SQL |
| 4 | Otras aplicaciones del mismo proyecto de Google Cloud | No se tenían en cuenta | `YOUTUBE_EXTERNAL_RESERVED_UNITS/_SEARCHES` (lo que declara el propietario) restan margen a los topes; si **YouTube responde cuota agotada**, ambos límites se bloquean hasta la medianoche del Pacífico (`markExhausted`) | `research-quota.test.ts` §3 |
| 5 | Cuota «disponible» sin verificar | Se mostraba como cifra segura | `verified` es siempre `false`; la pantalla dice «Esta aplicación ha usado…», «no la cifra oficial», avisa de otras aplicaciones y de la consola de Google Cloud; nunca usa «disponible» o «confirmado» | `research-quota.test.ts` §3 |
| 6 | Un fallo del contador abría búsquedas ilimitadas | `openStore` caía a un contador vacío en memoria ante **cualquier** error de la base | Solo cae a memoria si falta la tabla (`42P01`/`PGRST205`); cualquier otro error → `CounterUnavailableError` → HTTP 503 y **no se busca**. Las rutas de trending, canal y categorías ahora también reservan cuota. Sin contador persistente, el servidor adopta la cifra del navegador (solo puede subirla) | `research-quota.test.ts` §4 |
| 7 | «first time buyer UK» perdía vídeos legítimos | Cobertura por palabras sueltas | Frases equivalentes («buying your first home», «first-time homebuyer», «first home buyer», «property ladder»…) cubren los términos; coches y gimnasio siguen descartados | `research-audit-46fbf89.test.ts` |
| 8 | `#datoscuriosos` y portugués | Los hashtags largos se descartaban y las palabras compartidas español/portugués inclinaban la balanza | Un tema dentro de un hashtag cuenta; ñ/¿/¡ (español) y ã/õ (portugués) pesan; las palabras compartidas pesan la mitad; un español declarado `pt` ya no se descarta si el texto es claramente español | idem |

Además (no numerados en la auditoría pero pedidos): **anuncios** (`anuncio` / `patrocinado` con motivo; reseñas, enlaces de afiliado y «not sponsored» no se tocan), **oferta con ventana consistente** (ventana de la muestra bruta; un resultado antiguo suelto no la estira) y **ISA** conservado (religioso, militar y videojuegos siguen fuera).

## Persistencia
- **Medir crecimiento**: fallaba con «No se pudo analizar el tema» porque el servidor buscaba el análisis en su caché, que puede ser la memoria de otra instancia o estar vacía tras un despliegue. Ahora el navegador envía su propio análisis (validado: mismo tema, país, idioma y ventana, motor actual, números presentes); si no hay base, responde 422 con un mensaje claro y sin gastar.
- **Versiones del motor**: cada análisis lleva `engineVersion` (ahora 3). Las claves de caché pasan a `v3`; un análisis de motor anterior **no se sirve, no cuenta como hecho en el plan y no entra** en recomendaciones, huecos ni comparaciones. Se conserva y se muestra aparte («Análisis de una versión anterior del motor») con un botón para volver a analizarlo, y los guardados llevan un aviso.
- **`research_cache`**: migración actualizada (columna `searches`, `research_reserve` con ambos límites, rollback) y comprobada en PostgreSQL local; **sin aplicar**.

## Interfaz
Miniaturas (dirección estándar del vídeo si falta; marcador solo si falla), monetización (una cifra prestada de otro nicho, confianza «muy baja», ya no coloca un nicho como «mayor potencial» y se describe como referencia débil), etiquetas (fuente, país, idioma y confianza en español; «No calculable» en vez de una celda vacía; la ayuda del crecimiento ya no dice «50 = estable»), campañas (la moneda sigue al país: Reino Unido → GBP, con aviso si no coincide), numeración de los pasos (por orden mostrado, sin repetir) y avisos (se borran al cambiar de sección).

## Consumo estimado de cuota
Un análisis: ≈ 204 unidades y 2 búsquedas; medir crecimiento: ≈ 102 y 1; lista de tendencias: 2 unidades, 0 búsquedas. Con los topes por defecto (6.000 unidades, 60 búsquedas) caben ≈ 29–30 análisis al día; manda el que se agote antes. El trabajo de esta entrega: **0 unidades** (todo simulado).

## Pruebas reales que debe repetir Claude Chat (pocas consultas, ≈ 204 unidades cada una)
1. «first time buyer» (GB, en): en el inspector de muestra, ningún coche; «Buying your first home…» y «first-time homebuyer…» aceptados.
2. «datos curiosos» (ES, es): `#datoscuriosos` cuenta como tema; ningún español marcado como portugués; el portugués real sigue fuera.
3. Un tema con anuncios con muchas vistas: aparecen como «Anuncio» o «Vídeo patrocinado» con su motivo y no mueven la demanda; una reseña normal sigue contando.
4. «ISA explained» (GB, en): sin religioso, militar ni videojuegos.
5. **Medir crecimiento** tras recargar la página o desde otro dispositivo: cuesta +102 unidades y 1 búsqueda, y devuelve un resultado o un motivo claro.
6. Tras 2–3 análisis: el indicador de consumo (unidades y búsquedas) coincide con la consola de Google Cloud; anotar la diferencia (otras aplicaciones del proyecto, errores contados distinto).
7. Cambiar de sección con un error visible: el aviso desaparece. Numeración de los pasos sin repetidos.
8. Una campaña desde un tema de GB: moneda GBP.
9. Antes de autorizar `research_cache`: abrir un análisis antiguo guardado y ver el aviso de «versión anterior».
