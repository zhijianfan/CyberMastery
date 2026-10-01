import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export class ConfigShellError extends Schema.ErrorClass<ConfigShellError>("ConfigShellError")(
  { name: Schema.Literal("ConfigShellError"), message: Schema.String },
  { httpApiStatus: 500 },
) {}

export const ConfigGroup = HttpApiGroup.make("server.config")
  .add(
    HttpApiEndpoint.get("config.shell.get", "/api/config/shell", {
      query: LocationQuery,
      success: Location.response(Schema.Struct({ shell: Schema.String })),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.config.shell.get", summary: "Get effective shell" })),
  )
  .add(
    HttpApiEndpoint.patch("config.shell.update", "/api/config/shell", {
      query: LocationQuery,
      payload: Schema.Struct({ shell: Schema.NullOr(Schema.String) }),
      success: HttpApiSchema.NoContent,
      error: ConfigShellError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({ identifier: "v2.config.shell.update", summary: "Update global shell preference" }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "config", description: "Selected-host configuration routes." }))
