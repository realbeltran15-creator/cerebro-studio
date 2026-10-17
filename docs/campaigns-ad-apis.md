# Campañas: arquitectura de conexiones publicitarias

Estado a 2026-10-15: **ninguna conexión publicitaria está implementada ni autorizada.** Las campañas se diseñan, se guardan y se exportan sin ellas. Nada en la aplicación crea, publica ni activa anuncios, ni gasta presupuesto.

## Principios
1. **Diseñar ≠ ejecutar.** `lib/campaigns/strategy.ts` es una función pura: brief + supuestos → estrategia. No hace red.
2. **Una capacidad es «disponible» solo si existe su adaptador** (`adapters` en `lib/campaigns/connections.ts`, hoy vacío), la plataforma ha aprobado la app y la persona ha autorizado su cuenta. Tener las variables de entorno no basta (`readiness()` lo distingue y nunca devuelve valores).
3. **Crear en pausa.** El adaptador (`AdPlatformAdapter.createCampaignDraft`) crea el borrador en pausa; activar es otro paso con aprobación explícita (como ya hacen YouTube y Redes con la aprobación de publicación).
4. **Los tokens** de cuentas publicitarias, cuando existan, se guardan solo cifrados y en servidor, nunca en el brief ni en el navegador. Se reutilizará el patrón OAuth de `lib/oauth`.
5. **Límites y coste:** toda lectura de informes pasa por una caché y un presupuesto de llamadas, como Investigación.

## Requisitos por plataforma (comprobados en la documentación y búsquedas del 2026-10-15; confirmar en la fuente antes de solicitar nada)
| Plataforma | API | Autenticación y permisos | Aprobación |
|---|---|---|---|
| Google Ads | Google Ads API | OAuth 2.0, ámbito `https://www.googleapis.com/auth/adwords` + **token de desarrollador** de una cuenta de administrador (MCC) | Acceso de prueba (solo cuentas de prueba) → **Básico** (cuentas reales, 15.000 operaciones/día; revisión ~5 días laborables) → Estándar (sin límite práctico; ~10 días laborables, diseño detallado). El uso permitido declarado limita funciones. [Docs](https://developers.google.com/google-ads/api/docs/access-levels) |
| Meta Ads | Marketing API | OAuth de Meta con `ads_management`, `ads_read` (y `business_management` para activos del negocio) | Acceso estándar solo para cuentas propias o con rol en la app; **avanzado/completo** (cuentas de terceros) exige revisión de la app y verificación del negocio. Meta ha renombrado los niveles (estándar→limitado, avanzado→completo) y cambia los umbrales de uso. [Docs](https://developers.facebook.com/docs/marketing-api/get-started/authorization) |
| TikTok Ads | TikTok Marketing API | OAuth del anunciante; permisos de gestión de cuentas, de anuncios y de informes | App aprobada en el portal de TikTok for Business (hay sandbox); hasta entonces las cuentas reales no pueden autorizarla. Plazos publicados muy dispares. No confundir con la Content Posting API de Redes. [Docs](https://business-api.tiktok.com/portal/docs) |

## Fases propuestas (cada una requiere tu autorización)
1. **Solicitudes** (tú): MCC + token Google, negocio verificado + app Meta, app TikTok for Business. Sin código nuevo.
2. **Lectura de informes** por plataforma (solo lectura; permisos mínimos) para sustituir los supuestos de ejemplo por datos reales de un piloto.
3. **Borradores en pausa** desde una campaña de Cerebro Studio.
4. **Activación** con resumen de riesgos y gasto máximo, aprobación explícita y tope diario forzado por la app.

Estimaciones actuales: los escenarios usan CPM/CTR/conversión de **ejemplo editables**, marcados como no medidos.
