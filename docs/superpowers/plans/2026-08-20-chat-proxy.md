# Backend-Owned Chat Proxy Implementation Plan

> **Superseded — do not execute.** The implemented ChatProxy stack was removed
> on 2026-08-24 after ChatRelay moved to its canonical SessionV2 binding. This
> file remains only as migration history; its unchecked tasks are not current
> backlog items.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend-owned persistent Chromium session and route ChatRelay prompts and responses through ChatGPT's webpage.

**Architecture:** A global authenticated HttpApi group fronts a scoped Server service. The service lazily starts Playwright with a per-user persistent profile and maintains one ChatGPT page per relay, while the app polls compact provider and relay snapshots.

**Tech Stack:** TypeScript, Bun, Effect HttpApi, Playwright Chromium, SolidJS

**Spec:** `docs/superpowers/specs/2026-08-20-chat-proxy-design.md`

## Global Constraints

- The browser target is hardcoded to ChatGPT; arbitrary URLs are not accepted.
- Cookies and credentials never leave the Chromium profile.
- Browser startup is lazy and does not slow normal server startup.
- This execution does not run tests, typechecks, or git commands under the active workspace instructions.
- Public HttpApi changes require `bun run generate` from `packages/client`.

---

### Task 1: Chat Proxy schema and protocol

**Files:**
- Create: `packages/schema/src/chat-proxy.ts`
- Create: `packages/protocol/src/groups/chat-proxy.ts`
- Modify: `packages/protocol/src/api.ts`

**Interfaces:**
- Produces: `ChatProxy.Provider`, `ChatProxy.Message`, `ChatProxy.Relay`, and `server.chatProxy` endpoints.

- [ ] Define provider IDs, statuses, message roles, provider snapshots, relay snapshots, and prompt payloads.
- [ ] Define authenticated list/connect/open/disconnect/relay/prompt endpoints.
- [ ] Add `ChatProxyGroup` to the default Protocol API.

### Task 2: Backend Chromium lifecycle

**Files:**
- Create: `packages/server/src/chat-proxy.ts`
- Create: `packages/server/src/handlers/chat-proxy.ts`
- Modify: `packages/server/src/handlers.ts`
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `ChatProxyService.list(user)`, `connect(user, providerID)`, `open(user, providerID)`, `disconnect(user, providerID)`, `relay(user, providerID, relayID)`, and `prompt(user, providerID, relayID, text)`.

- [ ] Add Playwright as a Server runtime dependency using the root catalog version.
- [ ] Implement lazy persistent Chromium contexts under the global data directory.
- [ ] Detect disconnected, login-required, ready, and error provider states.
- [ ] Create one ChatGPT page per relay and keep it alive in the backend.
- [ ] Submit prompts through ChatGPT's composer and copy the newest assistant turn into relay state until stable.
- [ ] Add authorized HttpApi handlers and provide the scoped service to Server routes.

### Task 3: Settings Chat Proxy controls

**Files:**
- Create: `packages/app/src/components/settings-v2/chat-proxy.tsx`
- Create: `packages/app/src/components/settings-v2/chat-proxy.css`
- Modify: `packages/app/src/components/settings-v2/providers.tsx`

**Interfaces:**
- Consumes: `/api/chat-proxy` provider lifecycle endpoints.
- Produces: A Chat Proxy Settings section with ChatGPT Connect, Open, and Disconnect actions.

- [ ] Poll provider state while Settings is mounted.
- [ ] Render ChatGPT first with explicit browser and login status.
- [ ] Keep login interaction in the backend-owned visible browser.
- [ ] Surface browser installation and page errors without exposing credential data.

### Task 4: ChatRelay proxy transcript

**Files:**
- Create: `packages/app/src/pages/canvas/blocks/chat-relay/proxy-surface.tsx`
- Create: `packages/app/src/pages/canvas/blocks/chat-relay/proxy-surface.css`
- Modify: `packages/app/src/pages/canvas/blocks/chat-relay/view.tsx`
- Delete: `packages/app/src/pages/canvas/blocks/chat-relay/provider-availability.tsx`

**Interfaces:**
- Consumes: relay read and prompt endpoints with relay ID `<workspaceID>:<blockID>`.
- Produces: local transcript, composer, thinking indicator, streamed assistant text, and visible prompt errors.

- [ ] Replace the model-provider gate and Session surface with `ChatProxyRelaySurface`.
- [ ] Poll compact relay snapshots and scroll new messages into view.
- [ ] Submit one prompt at a time and preserve failed prompt context.
- [ ] Show actionable disconnected and login-required states pointing to Settings.

### Task 5: Generated client and dependency metadata

**Files:**
- Generated: `packages/client/src/generated/**`
- Generated: `packages/client/src/generated-effect/**`
- Generated: `bun.lock`

**Interfaces:**
- Consumes: the completed Protocol and Server HttpApi.
- Produces: generated clients containing the Chat Proxy API and a workspace lock entry for Playwright.

- [ ] Run `bun install --lockfile-only` from the repository root.
- [ ] Run `bun run generate` from `packages/client`.
- [ ] Do not run tests or typechecks unless separately requested.
