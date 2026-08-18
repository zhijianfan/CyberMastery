// Track Q1 — Session options for the embedded MasterAgent composer. The
// existing composer owns the queue path: while busy its queue action runs its
// existing handleSubmit(event, "queue"), which immediately admits the input to
// the host with delivery: "queue". These options only enable that path and
// keep no local queue state.

import type { SessionSurfaceTarget } from "../session-surface"

export interface MasterAgentQueueOptions {
  queueEnabled: boolean
  queue: (busy: boolean) => boolean
}

export interface MasterAgentSessionOptions extends MasterAgentQueueOptions {
  target: SessionSurfaceTarget
}

export function createMasterAgentSessionOptions(input: {
  sessionID: string
  directory?: string
  workspaceID?: string
}): MasterAgentSessionOptions {
  return {
    target: {
      sessionID: input.sessionID,
      ...(input.directory !== undefined ? { directory: input.directory } : {}),
      ...(input.workspaceID !== undefined ? { workspaceID: input.workspaceID } : {}),
    },
    queueEnabled: true,
    queue: (busy) => busy,
  }
}
