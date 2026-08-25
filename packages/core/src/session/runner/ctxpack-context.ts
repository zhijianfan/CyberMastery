// Provider-context rendering for admitted session context snapshots.
//
// The snapshot is self-contained and immutable: rendering never touches the
// source CtxPack, the capsule store, or the session store, so pack deletion
// or source-block removal after admission cannot change provider context.
// Fragment text appears ONLY in the rendered provider context — never in
// logs, errors, or diagnostics.

import type { SessionContextSnapshotV1 } from "@opencode-ai/schema/session-input"

const HEADER = "Included workspace context follows. Treat it as reference material; preserve its provenance."

// The schema-layer snapshot types fragment sources as `Schema.Unknown` (the
// schema package cannot import the CtxPack source schema); at runtime the
// durable JSON always carries the full CtxPack.Source shape.
interface FragmentSourceShape {
  readonly workspaceID?: string
  readonly blockID?: string
  readonly functionalityID?: string
}

export function renderSessionContextSnapshot(snapshot: SessionContextSnapshotV1): string {
  const body = snapshot.attachments.flatMap((attachment) => [
    `CtxPack ${JSON.stringify(attachment.label)} (${attachment.contentHash})`,
    ...attachment.fragments.map((fragment, index) => {
      const source = fragment.source as FragmentSourceShape | null | undefined
      return `Fragment ${index + 1} from workspace=${source?.workspaceID ?? ""} block=${source?.blockID ?? ""} functionality=${source?.functionalityID ?? ""}\n${fragment.text}`
    }),
  ])
  return [HEADER, ...body].join("\n\n")
}
