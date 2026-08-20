import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import fs from "node:fs"
import path from "node:path"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

// Dev-only diagnostic sink: the canvas POSTs pan-movement samples here while
// panning, and this middleware appends them to the project's test-data
// directory so the data can be read offline (it never runs in production).
const panDebugPlugin = {
  name: "canvas-pan-debug",
  apply: "serve",
  configureServer(server: { middlewares: { use: (path: string, handler: (req: any, res: any) => void) => void } }) {
    server.middlewares.use("/__canvas-pan-debug", (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405
        res.end()
        return
      }
      let body = ""
      req.on("data", (chunk: Buffer | string) => (body += chunk))
      req.on("end", () => {
        try {
          const dir = path.resolve(__dirname, "../../.test-data")
          fs.mkdirSync(dir, { recursive: true })
          fs.appendFileSync(path.join(dir, "canvas-pan-debug.jsonl"), body.endsWith("\n") ? body : `${body}\n`)
          res.statusCode = 200
          res.end("ok")
        } catch (error) {
          res.statusCode = 500
          res.end(String(error))
        }
      })
    })
  },
}

const devServerPort = Number(process.env.VITE_DEV_SERVER_PORT ?? 3000)

export default defineConfig(({ mode }) => ({
  plugins: [desktopPlugin, panDebugPlugin as any, sentry] as any,
  esbuild:
    mode === "development"
      ? {
          keepNames: true,
          minifyIdentifiers: false,
          minifySyntax: false,
          minifyWhitespace: false,
          treeShaking: false,
        }
      : undefined,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: devServerPort,
    strictPort: true,
    hmr: {
      clientPort: devServerPort,
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    minify: mode === "development" ? false : undefined,
    cssMinify: mode === "development" ? false : undefined,
    reportCompressedSize: mode !== "development",
    rollupOptions: {
      treeshake: mode === "development" ? false : undefined,
    },
  },
}))
