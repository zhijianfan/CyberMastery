interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
  readonly VITE_OPENCODE_CHANNEL?: "dev" | "beta" | "prod"

  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}

export declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

// The ctxpack components import the client-build subpath so `bun test
// --conditions=solid` keeps the real client runtime (the bare specifier
// resolves to the SSR entry, where createEffect is a no-op). Mirror the
// public types onto the deep path so tsgo typechecks it.
declare module "solid-js/dist/solid.js" {
  export {
    createContext,
    createEffect,
    createMemo,
    createRenderEffect,
    createSignal,
    onCleanup,
    useContext,
  } from "solid-js"
  export type { Accessor, JSX, Setter } from "solid-js"
}
