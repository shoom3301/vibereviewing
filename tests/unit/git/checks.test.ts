import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { treeHash, diffRange } from "../../../src/git/checks.js"

describe("git checks", () => {
  let dir: string
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vibereview-test-"))
    await execa("git", ["init", "-q"], { cwd: dir })
    await execa("git", ["config", "user.email", "t@t"], { cwd: dir })
    await execa("git", ["config", "user.name", "t"], { cwd: dir })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: dir })
    writeFileSync(join(dir, "a.txt"), "hello\n")
    await execa("git", ["add", "a.txt"], { cwd: dir })
    await execa("git", ["commit", "-q", "-m", "init"], { cwd: dir })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("treeHash returns a stable sha for HEAD's tree", async () => {
    const t1 = await treeHash(dir, "HEAD")
    const t2 = await treeHash(dir, "HEAD")
    expect(t1).toBe(t2)
    expect(t1).toMatch(/^[0-9a-f]{40}$/)
  })

  it("diffRange returns the diff between two commits", async () => {
    writeFileSync(join(dir, "a.txt"), "hello\nworld\n")
    await execa("git", ["commit", "-q", "-am", "world"], { cwd: dir })
    const diff = await diffRange(dir, "HEAD~1", "HEAD")
    expect(diff).toMatch(/\+world/)
  })
})
