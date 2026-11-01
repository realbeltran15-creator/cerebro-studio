/** A video saved with scenes in black or narration without voice must never be approved or published (it is stored as «incompleto», not as finished). */
export const INCOMPLETE_VIDEO_MESSAGE = 'Este vídeo se guardó incompleto (escenas en negro o narración sin voz). Termina el montaje y expórtalo de nuevo antes de aprobarlo o publicarlo.'

export const isIncompleteVideo = (provenance: Record<string, unknown> | null | undefined) => provenance?.incomplete === true
