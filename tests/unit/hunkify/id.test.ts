import { describe, it, expect } from "vitest"
import { computeHunkId } from "../../../src/hunkify/id.js"

describe("computeHunkId", () => {
  it("produces stable hash for identical hunk content", () => {
    const a = computeHunkId({
      file: "src/a.ts",
      oldStart: 10, oldLines: 3,
      newStart: 10, newLines: 4,
      body: "@@ -10,3 +10,4 @@\n line\n-old\n+new1\n+new2",
    })
    const b = computeHunkId({
      file: "src/a.ts",
      oldStart: 10, oldLines: 3,
      newStart: 10, newLines: 4,
      body: "@@ -10,3 +10,4 @@\n line\n-old\n+new1\n+new2",
    })
    expect(a).toBe(b)
  })

  it("changes when any field changes", () => {
    const base = {
      file: "src/a.ts",
      oldStart: 10, oldLines: 3,
      newStart: 10, newLines: 4,
      body: "@@ -10,3 +10,4 @@\n line\n-old\n+new",
    }
    const variants = [
      { ...base, file: "src/b.ts" },
      { ...base, oldStart: 11 },
      { ...base, oldLines: 4 },
      { ...base, newStart: 11 },
      { ...base, newLines: 5 },
      { ...base, body: base.body + " " },
    ]
    const baseHash = computeHunkId(base)
    for (const v of variants) {
      expect(computeHunkId(v)).not.toBe(baseHash)
    }
  })

  it("produces ids prefixed with h_ and of bounded length", () => {
    const id = computeHunkId({
      file: "x", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body: "x",
    })
    expect(id).toMatch(/^h_[0-9a-f]+$/)
    expect(id.length).toBeLessThanOrEqual(16)
  })
})
