# Google Drive en Cerebro Studio: configuración (una sola vez)

El botón «Desde Google Drive» abre el selector oficial de Google (Picker) con el permiso mínimo `drive.file`:
solo los archivos que eliges quedan accesibles. Necesita tres identificadores **públicos** (no son secretos):

| Variable (Vercel → Preview de `fase1-seguridad`) | Dónde se obtiene |
|---|---|
| `NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID` | Google Cloud → APIs y servicios → Credenciales → ID de cliente OAuth, tipo «Aplicación web». Termina en `.apps.googleusercontent.com`. |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Credenciales → Clave de API (restringida a «Google Picker API»). Empieza por `AIza`. |
| `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` | Número del proyecto de Google Cloud (solo dígitos, en el panel de inicio del proyecto). |

Pasos en Google Cloud (mismo proyecto para todo):
1. Biblioteca de APIs: activar **Google Picker API** y **Google Drive API**.
2. Pantalla de consentimiento OAuth: tipo Externo, en «Pruebas», añadir tu Gmail como usuario de prueba; ámbito `.../auth/drive.file`.
3. En el ID de cliente web: **Orígenes de JavaScript autorizados** = `https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app`.
4. En la clave de API: restricción de aplicación «Referentes HTTP» con ese mismo origen (`https://cerebro-studio-git-fase1-seguridad-jesus-e021.vercel.app/*`) y restricción de API a Picker.
5. En Vercel añadir las tres variables (entorno Preview, rama `fase1-seguridad`) y volver a desplegar.

Mientras falten, el panel muestra «Google Drive: requiere configuración» y el botón está desactivado (no finge funcionar).
