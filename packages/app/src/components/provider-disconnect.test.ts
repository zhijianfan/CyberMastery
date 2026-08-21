import { expect, test } from "bun:test"
import { disconnectProvider } from "./provider-disconnect"

test("disconnects a current provider by credential ID", async () => {
  const calls: string[] = []
  const disconnected = await disconnectProvider({
    protocol: "v2",
    providerID: "openai",
    connection: { type: "credential", id: "credential-1", label: "default" },
    removeCredential: async (credentialID) => calls.push(`credential:${credentialID}`),
    removeLegacy: async (providerID) => calls.push(`legacy:${providerID}`),
    disposeLegacy: async () => calls.push("dispose"),
  })

  expect(disconnected).toBe(true)
  expect(calls).toEqual(["credential:credential-1"])
})

test("does not offer credential removal for environment connections", async () => {
  const calls: string[] = []
  const disconnected = await disconnectProvider({
    protocol: "v2",
    providerID: "anthropic",
    connection: { type: "env", name: "ANTHROPIC_API_KEY" },
    removeCredential: async (credentialID) => calls.push(`credential:${credentialID}`),
    removeLegacy: async (providerID) => calls.push(`legacy:${providerID}`),
    disposeLegacy: async () => calls.push("dispose"),
  })

  expect(disconnected).toBe(false)
  expect(calls).toEqual([])
})

test("preserves legacy auth removal and disposal", async () => {
  const calls: string[] = []
  const disconnected = await disconnectProvider({
    protocol: "v1",
    providerID: "openai",
    removeCredential: async (credentialID) => calls.push(`credential:${credentialID}`),
    removeLegacy: async (providerID) => calls.push(`legacy:${providerID}`),
    disposeLegacy: async () => calls.push("dispose"),
  })

  expect(disconnected).toBe(true)
  expect(calls).toEqual(["legacy:openai", "dispose"])
})
