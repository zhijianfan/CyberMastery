export * as SessionRunner from "./index"

import type { LLMError } from "@opencode-ai/llm"
import { Context, Effect, Schema } from "effect"
import { SessionSchema } from "../schema"
import type { Prompt } from "../prompt"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | SystemContext.InitializationBlocked
  | ToolOutputStore.Error
  | CompactionFailedError

export class CompactionFailedError extends Schema.TaggedErrorClass<CompactionFailedError>()(
  "SessionRunner.CompactionFailedError",
  {},
) {}

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
  readonly compact: (input: {
    readonly sessionID: SessionSchema.ID
    readonly prompt?: Prompt
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunner") {}
