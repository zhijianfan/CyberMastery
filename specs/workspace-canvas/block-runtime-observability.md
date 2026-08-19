# Workspace Block Runtime Observability

## 1. Feature gate

- Env: `CYBERMASTER_BLOCK_RUNTIME_V2` (boolean).
- Default is **off**.
- Off means the legacy frontend path is active.
- On enables the v2 block-runtime path, when all runtime-path modules are wired.

## 2. How to tell which path is active

1. Compare the loaded bundle hash:

   - Open the browser network tab and find the served entry script in
     `packages/app/dist/assets/`.
   - The pre-runtime baseline is `index-mjRXeggk.js`.
   - After runtime-ui lands, the entry hash for the same build must be different.

2. Confirm the environment flag value in the app process:

   - If `CYBERMASTER_BLOCK_RUNTIME_V2` is not truthy, the legacy path is expected.
   - If truthy, continue with diagnostic validation below.

3. Confirm diagnostics wiring:

   - During runtime startup call `getBlockRuntimeDiagnostics()` from
     `packages/app/src/pages/canvas/diagnostics.ts` and verify a snapshot is
     returned.
   - In dev, `renderBlockRuntimeDiagnostics()` should print fields that include:
     descriptor, bindings, active adapter functionalityID, resource subscriptions,
     connection state, cursor/revision, last snapshot time, resync counters,
     and batch stats.

## 3. Network checks

- A prompt path that works in the new runtime must never send requests to
  `chatgpt.com/backend-api/conversation`.
- Browser traffic for prompt delivery must be confined to the local OpenCode/
  CyberMaster origin and its known event/snapshot endpoints.
- There must be no duplicate transport paths for one block prompt submission.
- If both legacy and v2 transport calls are seen, treat the UI as potentially
  stale and continue with failure triage.

## 4. Log redaction rules

- Never log OAuth credentials.
- Never log device tokens.
- Never log authorization headers.
- Never log full user message content unless an explicit debug mode is enabled that
  allows content logging.

  - In normal mode, keep logs at the event/structure level only.
  - In debug mode, log only the minimum content needed for reproduction and only
    with temporary operator intent.

## 5. Safe fallback policy

- `CYBERMASTER_BLOCK_RUNTIME_V2=0` (or unset): legacy prompt transport path.
- `CYBERMASTER_BLOCK_RUNTIME_V2=1`: v2 path.
- In v2, each block should have **exactly one prompt transport**.
- A slow or low-frequency status check is allowed only as a disconnected-mode
  diagnostic aid, never as the primary state source for prompt/session state.

## 6. Failure triage

| Symptom | Likely cause | Check |
| --- | --- | --- |
| UI appears frozen or does not reflect new assistant output | Stale bundle | Compare served entry hash with the runtime baseline and verify the hash changed from `index-mjRXeggk.js`.
| UI updates stop after a reconnect window | Disconnected stream | Check `connection state`, `resource subscription count`, and browser websocket/SSE traffic.
| UI shows old messages after reconnect but no new prompts | Failed snapshot | Check `last snapshot time`, `last cursor`, and `resync count + reason` from diagnostics.
| Prompt appears accepted but never runs on one block | Missing binding | Check `descriptor` and `bindings`; confirm active adapter functionalityID is present.
| UI advances cursor but timeline still lagging behind | Stale event batch behavior | Compare `event batch stats` and `last cursor/revision` while streaming bursts.
