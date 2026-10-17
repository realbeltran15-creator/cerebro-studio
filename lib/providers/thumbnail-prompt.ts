/** YouTube thumbnail prompt (shared by the Miniaturas page and the generation pipeline). */
export const thumbnailStyles = {
  documentary: 'authentic documentary photography look, natural dramatic light, grounded realistic details',
  cinematic: 'cinematic film still, dramatic lighting, rich depth, premium color grading',
  illustration: 'bold editorial illustration, clean shapes, strong silhouettes',
  minimal: 'minimalist composition, one strong subject, generous negative space, clean background',
} as const
export type ThumbnailStyle = keyof typeof thumbnailStyles
export type ThumbnailSpec = { concept: string; overlayText?: string | null; style?: string | null }

export function validThumbnail(t: unknown): ThumbnailSpec | null {
  const v = t as ThumbnailSpec | null
  if (!v || typeof v.concept !== 'string' || !v.concept.trim() || v.concept.length > 1500) return null
  if (v.overlayText && (typeof v.overlayText !== 'string' || v.overlayText.length > 40)) return null
  return { concept: v.concept.trim(), overlayText: v.overlayText?.trim() || null, style: v.style && v.style in thumbnailStyles ? v.style : 'documentary' }
}

export function thumbnailPrompt(t: ThumbnailSpec) {
  const style = thumbnailStyles[(t.style && t.style in thumbnailStyles ? t.style : 'documentary') as ThumbnailStyle]
  const textRule = t.overlayText
    ? `Include only this exact text, large, bold and legible, with strong contrast: "${t.overlayText}". No other text.`
    : 'No text, letters, logos or watermarks anywhere in the image.'
  return `YouTube video thumbnail, 16:9 landscape. Concept: ${t.concept}\n\nVisual direction: ${style}. One clear focal subject readable at small size, high contrast, uncluttered background, strong emotional clarity without exaggerated or misleading elements. ${textRule} Original image; do not imitate real people's likeness or brand marks.`
}
