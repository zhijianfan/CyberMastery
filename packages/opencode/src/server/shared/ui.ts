import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import path from "node:path"
import { ProxyUtil } from "../proxy-util"

let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

export const UI_UPSTREAM = new URL("https://app.opencode.ai")

export const csp = (hash = "", allowInlineScripts = false) =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${allowInlineScripts ? " 'unsafe-inline'" : ""}${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string, allowInlineScripts = false) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "", allowInlineScripts)
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

export function upstreamURL(path: string, upstream = UI_UPSTREAM) {
  return new URL(path, upstream).toString()
}

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-ignore - generated module: written next to this file by
    // script/embed-web-ui.ts (dev embed) or injected by script/build.ts
    // (binary); absent in a clean checkout
    import("./opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null))
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function embeddedUIResponse(file: string, body: Uint8Array, cacheControl?: string) {
  const mime = FSUtil.mimeType(file)
  const headers = new Headers({ "content-type": mime })
  if (cacheControl) headers.set("cache-control", cacheControl)
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
  }
  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
) {
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  return fs.readFile(file).pipe(
    Effect.map((body) => embeddedUIResponse(file, body)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

export function serveDirectoryUIEffect(requestPath: string, fs: FSUtil.Interface, directory: string) {
  const root = path.resolve(directory)
  const file = resolveUIFile(root, requestPath)
  if (!file) return Effect.succeed(notFound())

  const index = path.join(root, "index.html")
  const read = (target: string) => fs.readFile(target).pipe(Effect.map((body) => ({ target, body })))
  return read(file).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => read(index)),
    Effect.map((result) => embeddedUIResponse(result.target, result.body, "no-store")),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

function resolveUIFile(root: string, requestPath: string) {
  try {
    const decoded = decodeURIComponent(requestPath)
    if (decoded.endsWith("/")) return path.join(root, "index.html")
    const file = path.resolve(root, `.${decoded}`)
    if (file !== root && !file.startsWith(root + path.sep)) return
    return file
  } catch {
    return
  }
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: {
    fs: FSUtil.Interface
    client: HttpClient.HttpClient
    disableEmbeddedWebUi: boolean
    uiDirectory?: string
  },
) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const path = url.pathname
    const uiDirectory = services.uiDirectory ?? process.env.OPENCODE_WEB_UI_DIR
    if (uiDirectory) return yield* serveDirectoryUIEffect(path, services.fs, uiDirectory)

    const localUI = process.env.OPENCODE_WEB_UI_URL
    if (!localUI) {
      const embeddedWebUI = yield* Effect.promise(() => embeddedUI(services.disableEmbeddedWebUi))
      if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI)
    }

    const upstream = localUI ? new URL(localUI) : UI_UPSTREAM

    const response = yield* services.client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(`${path}${url.search}`, upstream), {
        headers: ProxyUtil.headers(request.headers, { host: upstream.host }),
        body: requestBody(request),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)

    if (response.headers["content-type"]?.includes("text/html")) {
      const body = yield* response.text
      headers.set("Content-Security-Policy", cspForHtml(body, Boolean(localUI)))
      return HttpServerResponse.text(body, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
