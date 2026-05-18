import { describe, it, expect } from "vitest"
import { renderLayerPatch } from "../../../src/apply/render.js"
import type { Hunk, FileChange } from "../../../src/hunkify/types.js"

function h(file: string, body: string, id: string, oldStart = 1, oldLines = 1, newStart = 1, newLines = 1): Hunk {
  return {
    id, file, oldPath: null, oldStart, oldLines, newStart, newLines, body,
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false, isModeChange: false,
    context: { fileLanguage: "ts", isGenerated: false, domainFloor: "A" },
  }
}

describe("renderLayerPatch", () => {
  it("renders a unified patch with proper file headers", () => {
    const hunk = h("src/a.ts",
      "@@ -1,1 +1,1 @@\n-old\n+new", "h_1")
    const file: FileChange = {
      file: "src/a.ts", oldPath: "src/a.ts", language: "ts",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false, hunks: [hunk],
    }
    const patch = renderLayerPatch([file], new Set(["h_1"]))
    expect(patch).toContain("diff --git a/src/a.ts b/src/a.ts")
    expect(patch).toContain("--- a/src/a.ts")
    expect(patch).toContain("+++ b/src/a.ts")
    expect(patch).toContain("@@ -1,1 +1,1 @@")
  })

  it("emits hunks in oldStart order per file", () => {
    const f: FileChange = {
      file: "src/a.ts", oldPath: "src/a.ts", language: "ts",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false,
      hunks: [
        h("src/a.ts", "@@ -50,1 +50,1 @@\n-z\n+Z", "h_50", 50, 1, 50, 1),
        h("src/a.ts", "@@ -10,1 +10,1 @@\n-a\n+A", "h_10", 10, 1, 10, 1),
      ],
    }
    const patch = renderLayerPatch([f], new Set(["h_10", "h_50"]))
    const idx10 = patch.indexOf("@@ -10")
    const idx50 = patch.indexOf("@@ -50")
    expect(idx10).toBeGreaterThanOrEqual(0)
    expect(idx10).toBeLessThan(idx50)
  })

  it("includes a rename header when the file is a rename", () => {
    const hunk = h("src/new.ts", "@@ -1,1 +1,1 @@\n-old\n+new", "h_1")
    const f: FileChange = {
      file: "src/new.ts", oldPath: "src/old.ts", language: "ts",
      isBinary: false, isRename: true, isDelete: false, isSubmodule: false, hunks: [hunk],
    }
    const patch = renderLayerPatch([f], new Set(["h_1"]))
    expect(patch).toContain("rename from src/old.ts")
    expect(patch).toContain("rename to src/new.ts")
  })

  it("omits files where no hunk is in the selected layer", () => {
    const f: FileChange = {
      file: "src/skip.ts", oldPath: "src/skip.ts", language: "ts",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false,
      hunks: [h("src/skip.ts", "@@ -1,1 +1,1 @@\n-a\n+b", "h_a")],
    }
    const patch = renderLayerPatch([f], new Set([]))
    expect(patch).toBe("")
  })
})
