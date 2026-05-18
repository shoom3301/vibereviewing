import { describe, it, expect } from "vitest"
import { detectFromEnv, requireKey } from "../../../src/classify/select.js"

describe("detectFromEnv", () => {
  it("prefers ANTHROPIC_API_KEY", () => {
    expect(detectFromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b" })).toBe("claude")
  })

  it("falls back to OPENAI_API_KEY", () => {
    expect(detectFromEnv({ OPENAI_API_KEY: "b" })).toBe("openai")
  })

  it("returns null when neither is set", () => {
    expect(detectFromEnv({})).toBeNull()
  })
})

describe("requireKey", () => {
  it("returns the key for claude", () => {
    expect(requireKey("claude", { ANTHROPIC_API_KEY: "a" })).toBe("a")
  })

  it("throws when the required key is missing", () => {
    expect(() => requireKey("openai", {})).toThrow(/OPENAI_API_KEY/)
  })
})
