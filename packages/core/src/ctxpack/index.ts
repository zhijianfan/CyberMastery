// CtxPack domain barrel (M1 integration): namespace re-exports so composition
// roots import lane nodes by name, plus the M1 port adapters.

export * as CtxPackSQL from "./sql"
export * as CtxPackService from "./service"
export * as CtxPackMaterializer from "./materialize"
export * as CtxPackEvents from "./events"
export * as CtxPackUsage from "./usage"
export * as CtxPackObservability from "./observability"
export * as CtxPackSearch from "./search"
export * as CtxPackValidation from "./validation"
export * as CtxPackHash from "./hash"
export * as CtxPackAccess from "./access"
export * as CtxPackRecall from "./recall"
export * as CtxPackSessionContext from "./session-context"
export {
  ctxPackEventPortNode,
  ctxPackUsagePortNode,
  sessionContextAssemblyPortNode,
  workspaceMembershipLive,
} from "./wiring"
