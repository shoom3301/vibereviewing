import { describe, it, expect } from "vitest"
import { renderPrBody, type PrBodyArgs } from "../../../src/render/prBody.js"

const sample: PrBodyArgs = {
  sourcePR: { owner: "cowprotocol", repo: "cowswap", number: 1234, headSha: "def456a" },
  companion: { owner: "cowprotocol", repo: "cowswap", number: 5678 },
  layers: [
    {
      layer: "A", commitSha: "a1b2c3d", hunks: 22, files: 8,
      entries: [{ file: "src/Tooltip.tsx", line: 11, intent: "typo", rationale: "Closes unclosed <p> tag" }],
    },
    {
      layer: "B", commitSha: "d4e5f6a", hunks: 11, files: 5,
      entries: [{ file: "src/empty.tsx", line: 1, intent: "ui_pure", rationale: "New empty state component" }],
    },
    {
      layer: "C", commitSha: "f7a8b9c", hunks: 14, files: 6,
      entries: [{ file: "src/quote/calc.ts", line: 58, intent: "business_logic", rationale: "Adds MIN_AMOUNT check" }],
    },
  ],
  escalations: [
    { hunkId: "h_x", file: "src/quote/calculator.ts", line: 58, from: "A", to: "C",
      reason: "domain_floor" },
  ],
  provenance: {
    generatedAt: new Date("2026-05-17T14:32:00Z"),
    toolVersion: "0.1.0",
    provider: "claude",
    model: "claude-opus-4-7",
  },
}

describe("renderPrBody", () => {
  const body = renderPrBody(sample)

  it("includes the 'do not merge' notice", () => {
    expect(body).toMatch(/not meant to be merged/i)
  })

  it("includes a layer table with commit shas, counts, and review depth", () => {
    expect(body).toContain("a1b2c3d")
    expect(body).toContain("d4e5f6a")
    expect(body).toContain("f7a8b9c")
    expect(body).toMatch(/Skim or trust CodeRabbit/)
    expect(body).toMatch(/Full review/)
  })

  it("surfaces the copy-paste git diff command for layer C only", () => {
    expect(body).toContain("git diff d4e5f6a..f7a8b9c")
  })

  it("includes per-layer collapsible manifests with C open", () => {
    expect(body).toMatch(/<details>\s*<summary>22 hunks in Layer A/)
    expect(body).toMatch(/<details open>\s*<summary>14 hunks in Layer C/)
  })

  it("renders an Escalations section only when present", () => {
    expect(body).toContain("## Escalations")
    const empty = renderPrBody({ ...sample, escalations: [] })
    expect(empty).not.toContain("## Escalations")
  })

  it("includes provenance with version, provider, model", () => {
    expect(body).toContain("vibereview@0.1.0")
    expect(body).toContain("claude")
    expect(body).toContain("claude-opus-4-7")
  })
})
