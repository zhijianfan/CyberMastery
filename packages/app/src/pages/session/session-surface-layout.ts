const DESKTOP_WIDTH = 768

export function sessionSurfaceDesktop(input: {
  embedded: boolean
  containerWidth?: number
  viewportDesktop: boolean
}) {
  if (!input.embedded) return input.viewportDesktop
  return (input.containerWidth ?? 0) >= DESKTOP_WIDTH
}
