// Canvas feature flags. Kept dead by default; the integration lead (M) flips
// flags when the corresponding runtime wiring lands.
//
// BLOCK_RUNTIME_V3: gates the generic BlockRuntimeHost registration path.
// Flip to true once every Wave-2 registration (chat-relay, master-agent,
// operating-chat, notes, voice) is wired in workspace.tsx by M.
export const BLOCK_RUNTIME_V3 = false
