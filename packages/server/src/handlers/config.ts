import { Config } from "@opencode-ai/core/config"
import { Shell } from "@opencode-ai/core/shell"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { ConfigShellError } from "@opencode-ai/protocol/groups/config"
import { Api } from "../api"
import { response } from "../location"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  handlers
    .handle("config.shell.get", () =>
      response(
        Effect.gen(function* () {
          const config = yield* Config.Service
          return { shell: Shell.preferred(Config.latest(yield* config.entries(), "shell")) }
        }),
      ),
    )
    .handle(
      "config.shell.update",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        yield* config.updateGlobalShell(ctx.payload.shell ?? undefined).pipe(
          Effect.mapError(
            () =>
              new ConfigShellError({
                name: "ConfigShellError",
                message: "Unable to update global shell configuration",
              }),
          ),
        )
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
