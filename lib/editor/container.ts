/** Container of a recorded/uploaded video from its MIME type. */
export const containerOf = (mime: string | null | undefined): 'mp4' | 'webm' => (mime ?? '').startsWith('video/mp4') ? 'mp4' : 'webm'
