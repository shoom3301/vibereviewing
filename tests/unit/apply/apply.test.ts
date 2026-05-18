import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyPatchOrEscalate } from "../../../src/apply/apply.js"

describe("applyPatchOrEscalate", () => {
  let repo: string

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-apply-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "line1\nline2\nline3\n")
    await execa("git", ["add", "f.txt"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "init"], { cwd: repo })
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("applies a clean patch", async () => {
    const patch =
`diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 line1
-line2
+LINE2
 line3
`
    const result = await applyPatchOrEscalate(repo, patch)
    expect(result.applied).toBe(true)
    expect(result.rejectedHunks).toEqual([])
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toContain("LINE2")
  })

  it("returns rejected hunks for a patch that cannot apply", async () => {
    const patch =
`diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 nonexistent
-line2
+CHANGED
 line3
`
    const result = await applyPatchOrEscalate(repo, patch)
    expect(result.applied).toBe(false)
    expect(result.rejectedHunks.length).toBeGreaterThan(0)
  })
})
