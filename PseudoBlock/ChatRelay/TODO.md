# ChatRelay — TODO

- [x] Pseudo block design (README.md)
- [x] Account authentication (OAuth device flow) initialization — the block
  cannot route until authenticated
- [x] Account-auth subsystem: send message through the platform API
- [x] Account-auth subsystem: capture the assistant reply from the stream
- [x] First provider: ChatGPT, using opencode's built-in ChatGPT/Codex OAuth app
- [x] Per-chat-session context storage relayed to the workspace's OperatingAgent
- [x] Store all relayed messages
- [x] Session persistence: the stored session (incl. conversation threading)
  survives server restarts
- [x] Host API: `relay.initialize/status/submit/dispose` + SDK + canvas block
  wiring, incl. the awaiting-login verification link/code state
- [ ] **Process stored text — NOT IMPLEMENTED**
- [ ] Modify relayed messages (trim/reformat) before submission to the
  OperatingAgent — NOT IMPLEMENTED
