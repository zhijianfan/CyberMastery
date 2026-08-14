# ChatGPTRouter — Pseudo Block

Functionality id: `builtin:chatgpt-router`
Status: draft (see TODO.md)
Referenced from: `specs/workspace-canvas/architecture.md` §11 (Pseudo blocks)

## 1. What it is

ChatGPTRouter is a pseudo block: its functionality reroutes the block to the
ChatGPT webpage instead of executing locally. The block is essentially a
reroute for the ChatGPT webpage.

## 2. Initialization

- The block must be initialized with a ChatGPT login before routing.
- Without a valid login the block renders an unavailable/needs-login state
  (per `requirements.md` §8.20 error-block conventions).

## 3. Crawler-like subsystem

Simple data processing is handled by a crawler-like subsystem:

1. download files
2. extract response
3. type in message
4. submit

The subsystem drives the ChatGPT webpage through these four steps for every
relayed submission.

## 4. Session context storage

- Each chat session has its own context storage.
- The stored context is relayed to the workspace's agent API (the
  OperatingAgent, per `architecture.md` §10).
- Each relayed message becomes part of the session's OperatingContext stack:
  WorkspaceContext → BlockContext → OperationalContext → CustomContext →
  HistoricalContextStack.

## 5. Current storage behavior

- The subsystem stores **all** relayed messages for now.
- Processing of the stored text is **not implemented** — see TODO.md.
