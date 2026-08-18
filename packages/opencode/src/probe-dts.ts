import { createRoutes } from "./server/routes/instance/httpapi/server"
export const probeRoutes = createRoutes()
export type ProbeRoutes = typeof probeRoutes
