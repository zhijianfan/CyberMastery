import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionRuntime } from "../src/session-runtime"
import { Session } from "../src/session"
import { SessionV1 } from "../src/session-v1"
import { AbsolutePath } from "../src/schema"
import { Project } from "../src/project"
import { SessionID } from "../src/session-id"

describe("SessionRuntime", () => {
  test("is the closed legacy, v2, mixed discriminator", () => {
    expect(Schema.decodeUnknownSync(SessionRuntime)("legacy")).toBe("legacy")
    expect(Schema.decodeUnknownSync(SessionRuntime)("v2")).toBe("v2")
    expect(Schema.decodeUnknownSync(SessionRuntime)("mixed")).toBe("mixed")
    expect(() => Schema.decodeUnknownSync(SessionRuntime)("unknown")).toThrow()
  })

  test("keeps current and V1 session info runtime optional on the wire", () => {
    const current = Session.Info.make({
      id: Session.ID.make("ses_current"),
      projectID: Project.ID.make("prj_current"),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      title: "current",
      location: { directory: AbsolutePath.make("/project") },
    })
    const legacy = SessionV1.SessionInfo.make({
      id: SessionID.make("ses_legacy"),
      slug: "legacy",
      projectID: Project.ID.make("prj_legacy"),
      directory: "/project",
      title: "legacy",
      version: "test",
      time: { created: 0, updated: 0 },
    })

    expect(Schema.encodeSync(Session.Info)(current)).not.toHaveProperty("runtime")
    expect(Schema.encodeSync(SessionV1.SessionInfo)(legacy)).not.toHaveProperty("runtime")
    expect(
      Schema.decodeUnknownSync(Session.Info)({ ...Schema.encodeSync(Session.Info)(current), runtime: "v2" }).runtime,
    ).toBe("v2")
    expect(
      Schema.decodeUnknownSync(SessionV1.SessionInfo)({
        ...Schema.encodeSync(SessionV1.SessionInfo)(legacy),
        runtime: "mixed",
      }).runtime,
    ).toBe("mixed")
  })
})
