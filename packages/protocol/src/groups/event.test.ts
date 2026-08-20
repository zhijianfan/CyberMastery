import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { OpenCodeEvent } from "./event"

const encode = Schema.encodeUnknownSync(OpenCodeEvent)

describe("OpenCodeEvent", () => {
  test("encodes workspace runtime events", () => {
    const events = [
      {
        id: "evt_layout",
        type: "workspace.layout.updated",
        data: { workspaceID: "wrk_event", revision: 1 },
      },
      {
        id: "evt_instance",
        type: "workspace.functionality.instance.changed",
        data: {
          workspaceID: "wrk_event",
          blockID: "block-1",
          functionalityID: "builtin:chat-relay",
          instanceID: "instance-1",
          revision: 1,
          change: "created",
        },
      },
      {
        id: "evt_master",
        type: "workspace.master-agent.binding.updated",
        data: {
          workspaceID: "wrk_event",
          blockID: "block-1",
          sessionID: "ses_event",
          generation: 0,
          revision: 1,
        },
      },
      {
        id: "evt_relay",
        type: "workspace.chatRelay.binding.updated",
        data: {
          workspaceID: "wrk_event",
          blockID: "block-2",
          sessionID: "ses_relay",
          generation: 0,
          revision: 1,
        },
      },
    ]

    expect(events.map((event) => encode(event).type)).toEqual([
      "workspace.layout.updated",
      "workspace.functionality.instance.changed",
      "workspace.master-agent.binding.updated",
      "workspace.chatRelay.binding.updated",
    ])
  })
})
