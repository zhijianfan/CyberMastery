export * as SessionCreate from "./create"

import { Effect } from "effect"
import path from "path"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import { Slug } from "../util/slug"
import { WorkspaceV2 } from "../workspace"
import { SessionV1 } from "../v1/session"
import { SessionProjector } from "./projector"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

export type Input = {
  readonly id?: SessionSchema.ID
  readonly parentID?: SessionSchema.ID
  readonly title?: string
  readonly agent?: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly location: Location.Ref
}

export function make(
  database: Database.Interface,
  events: EventV2.Interface,
  projects: ProjectV2.Interface,
  store: SessionStore.Interface,
) {
  return Effect.fn("SessionCreate.create")(function* (input: Input) {
    const { db } = database
    const sessionID = input.id ?? SessionSchema.ID.create()
    const recorded = yield* store.get(sessionID)
    if (recorded) return recorded
    const project = yield* projects.resolve(input.location.directory)
    yield* db
      .insert(ProjectTable)
      .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const now = Date.now()
    const info = SessionV1.SessionInfo.make({
      id: sessionID,
      slug: Slug.create(),
      version: InstallationVersion,
      projectID: project.id,
      directory: input.location.directory,
      path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
      workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
      parentID: input.parentID,
      title: input.title ?? `New session - ${new Date(now).toISOString()}`,
      agent: input.agent,
      model: input.model
        ? {
            id: ModelV2.ID.make(input.model.id),
            providerID: input.model.providerID,
            variant: input.model.variant,
          }
        : undefined,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: now, updated: now },
    })
    const projected = yield* events
      .publish(SessionV1.Event.Created, { sessionID, info }, { location: input.location })
      .pipe(
        Effect.as({ type: "created" } as const),
        Effect.catchDefect((defect) => {
          if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) return Effect.die(defect)
          return store.get(sessionID).pipe(
            Effect.flatMap((session) =>
              session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
            ),
          )
        }),
      )
    if (projected.type === "existing") return projected.session
    return yield* store.get(sessionID).pipe(
      Effect.flatMap((session) => (session ? Effect.succeed(session) : Effect.die("Created Session projection was not found"))),
    )
  })
}
