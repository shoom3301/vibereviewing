import { describe, it, expect, vi } from "vitest"
import { runVerify } from "../../../src/commands/verify.js"
import { formatTrailers } from "../../../src/trailer/format.js"

const trailer = (overrides: Partial<Parameters<typeof formatTrailers>[0]> = {}) =>
  formatTrailers({
    layer: "A",
    sourcePR: "x/y#1",
    sourceHead: "abc1234",
    hunkIds: ["h_1", "h_2"],
    toolVersion: "0.1.0",
    provider: "claude",
    model: "claude-opus-4-7",
    ...overrides,
  })

describe("runVerify", () => {
  it("passes when current source head matches the trailer + ids cover the diff", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer({ layer: "A", hunkIds: ["h_a"] })}` },
        { layer: "C", message: `t\n\n${trailer({ layer: "C", hunkIds: ["h_c"] })}` },
      ],
      fetchSourceHead: async () => "abc1234",
      hunkIdsForSource: async () => new Set(["h_a", "h_c"]),
      compareTrees: async () => true,
    })
    expect(result.ok).toBe(true)
  })

  it("fails when source head moved after the split", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer()}` },
      ],
      fetchSourceHead: async () => "deadbeef",
      hunkIdsForSource: async () => new Set(["h_1", "h_2"]),
      compareTrees: async () => true,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/source PR moved/i)
  })

  it("fails when hunk ids do not cover the source diff", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer({ hunkIds: ["h_1"] })}` },
      ],
      fetchSourceHead: async () => "abc1234",
      hunkIdsForSource: async () => new Set(["h_1", "h_extra"]),
      compareTrees: async () => true,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/missing|extra|mismatch/i)
  })

  it("fails when tree equality check fails", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer({ hunkIds: ["h_1"] })}` },
      ],
      fetchSourceHead: async () => "abc1234",
      hunkIdsForSource: async () => new Set(["h_1"]),
      compareTrees: async () => false,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/tree/i)
  })
})
