import { describe, it, expect } from "vitest"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { loadConfig, DEFAULT_CONFIG } from "../../../src/config/load.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fx = (name: string) => join(__dirname, "../../fixtures/configs", name)

describe("loadConfig", () => {
  it("loads and validates a valid file", () => {
    const cfg = loadConfig(fx("valid.yml"))
    expect(cfg.floors.C).toContain("**/settlement/**")
    expect(cfg.confidence_threshold).toBe(0.65)
    expect(cfg.providers.claude.model).toBe("claude-opus-4-7")
  })

  it("returns defaults when path does not exist", () => {
    const cfg = loadConfig("/tmp/does-not-exist-vibereview.yml")
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it("throws on malformed yaml", () => {
    expect(() => loadConfig(fx("malformed.yml"))).toThrow(/floors\.C/)
  })

  it("default confidence_threshold is 0.7", () => {
    expect(DEFAULT_CONFIG.confidence_threshold).toBe(0.7)
  })

  it("default max_diff_tokens is 200000", () => {
    expect(DEFAULT_CONFIG.max_diff_tokens).toBe(890000)
  })

  it("default models are cheap classifiers", () => {
    expect(DEFAULT_CONFIG.providers.claude.model).toBe("claude-haiku-4-5")
    expect(DEFAULT_CONFIG.providers.openai.model).toBe("gpt-5-mini")
  })
})
