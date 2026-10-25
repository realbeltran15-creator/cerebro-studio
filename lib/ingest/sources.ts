/**
 * Real status of each import source, shown in «Importar materiales». Only what is implemented is `available`;
 * the rest says why it is not. Nothing here pretends an integration works.
 */
export type SourceState = 'available' | 'needs_connection' | 'needs_config' | 'unsupported' | 'planned'
export type SourceStatus = { id: string; group: 'Mis dispositivos' | 'Mi nube' | 'Bibliotecas de contenido'; name: string; state: SourceState; note?: string }

export function sourceStatuses(env: { driveConfigured: boolean }): SourceStatus[] {
  return [
    { id: 'computer', group: 'Mis dispositivos', name: 'Mi ordenador', state: 'available', note: 'selector, varios archivos y arrastrar y soltar' },
    { id: 'phone', group: 'Mis dispositivos', name: 'Mi teléfono (enlace o QR)', state: 'planned' },
    { id: 'drive', group: 'Mi nube', name: 'Google Drive', state: env.driveConfigured ? 'available' : 'needs_config', note: env.driveConfigured ? 'te pedirá permiso de Google la primera vez' : 'faltan los identificadores públicos del selector' },
    { id: 'onedrive', group: 'Mi nube', name: 'OneDrive', state: 'planned' },
    { id: 'dropbox', group: 'Mi nube', name: 'Dropbox', state: 'planned' },
    { id: 'icloud', group: 'Mi nube', name: 'iCloud Drive', state: 'unsupported', note: 'Apple no ofrece una API pública para webs; usa «Desde mi dispositivo» con el selector de Archivos del iPhone' },
  ]
}
