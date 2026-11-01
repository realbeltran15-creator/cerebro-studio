/** Enlace al Editor con el storyboard elegido. Solo navega: el Editor sincroniza escenas con syncWithScenes (conserva lo asignado) y no pisa montajes manuales. */
export function editorHrefForStoryboard(projectId: string, storyboardId: string) {
  return `/editor?project=${encodeURIComponent(projectId)}&storyboard=${encodeURIComponent(storyboardId)}`
}
