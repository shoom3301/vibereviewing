import { describe, it, expect } from "vitest"
import { buildSystemPrompt } from "../../../src/classify/prompt.js"
import { DEFAULT_CONFIG } from "../../../src/config/load.js"

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt({
    config: {
      ...DEFAULT_CONFIG,
      floors: { B: ["tsconfig*.json"], C: ["**/settlement/**"] },
      generated: ["**/*.generated.ts"],
    },
  })

  it("includes the role statement", () => {
    expect(prompt).toMatch(/classify code-diff hunks/i)
  })

  it("includes layer definitions", () => {
    expect(prompt).toMatch(/Layer A/)
    expect(prompt).toMatch(/Layer B/)
    expect(prompt).toMatch(/Layer C/)
  })

  it("includes promotion rules", () => {
    expect(prompt).toMatch(/Promotion rules/i)
    expect(prompt).toMatch(/domain floor/i)
  })

  it("inlines the repo config", () => {
    expect(prompt).toContain("**/settlement/**")
    expect(prompt).toContain("**/*.generated.ts")
  })

  it("includes calibration guidance biased toward C", () => {
    expect(prompt).toMatch(/prefer the higher layer when uncertain/i)
  })

  it("includes format directive demanding full coverage", () => {
    expect(prompt).toMatch(/every input hunk_id/i)
  })
})
