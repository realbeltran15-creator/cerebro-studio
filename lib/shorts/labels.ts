export const STATUS_LABEL: Record<string, [string, string]> = {
  preparing: ['PREPARANDO', 'warn'], discarded: ['DESCARTADO', 'bad'], ready_for_approval: ['PENDIENTE DE TU APROBACIÓN', 'warn'],
  approved: ['APROBADO · SIN SUBIR', 'ok'], rejected: ['RECHAZADO', 'bad'], uploading: ['SUBIENDO', 'warn'],
  uploaded_private: ['SUBIDO COMO PRIVADO', 'ok'], upload_failed: ['SUBIDA FALLIDA', 'bad'],
}

export const REASONS: Record<string, string> = {
  sin_interes_comprobado: 'Ningún tema tenía interés comprobado en Radar/Market Intelligence',
  sin_encaje_con_el_canal: 'Ningún tema encajaba con el canal',
  sin_dato_verificable: 'No hubo un dato verificable',
  sin_dos_fuentes_fiables: 'No se lograron 2 fuentes fiables verificadas',
  guion_bajo_calidad_minima: 'El guion no alcanzó la calidad mínima (hook/estructura)',
  audio_bajo_calidad_minima: 'La voz gratuita no alcanzó la calidad mínima (duración o hook en 2 s)',
  cuota_gratuita_agotada: 'Se agotó la cuota gratuita: no se paga, hoy no hay Short',
  error_tecnico: 'Error técnico',
}
