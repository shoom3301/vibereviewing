import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withWorktree } from "../../../src/apply/worktree.js"

describe("withWorktree", () => {
  let repo: string
  let baseSha: string

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-repo-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "a.txt"), "v1\n")
    await execa("git", ["add", "a.txt"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "v1"], { cwd: repo })
    baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("creates a worktree at base, runs the callback, and removes the worktree", async () => {
    let wtPath = ""
    const result = await withWorktree(repo, baseSha, async (wt) => {
      wtPath = wt.path
      expect(existsSync(wt.path)).toBe(true)
      return "ok"
    })
    expect(result).toBe("ok")
    expect(existsSync(wtPath)).toBe(false)
  })

  it("removes the worktree even if the callback throws", async () => {
    let wtPath = ""
    await expect(withWorktree(repo, baseSha, async (wt) => {
      wtPath = wt.path
      throw new Error("boom")
    })).rejects.toThrow("boom")
    expect(existsSync(wtPath)).toBe(false)
  })
})
