import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkIntegrity } from "../../../src/apply/integrity.js"

describe("checkIntegrity", () => {
  let repo: string
  let baseSha = ""
  let originalSha = ""
  let companionSha = ""

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-int-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "base\n")
    await execa("git", ["add", "f.txt"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "base"], { cwd: repo })
    baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    writeFileSync(join(repo, "f.txt"), "base\nmore\n")
    await execa("git", ["commit", "-q", "-am", "original"], { cwd: repo })
    originalSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    // Companion: branch from base, two commits that together produce the same tree as original.
    await execa("git", ["checkout", "-q", "-b", "companion", baseSha], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "base\nmore\n")
    await execa("git", ["commit", "-q", "-am", "companion full"], { cwd: repo })
    companionSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("passes when tree(companion) == tree(original) and diffs match", async () => {
    const result = await checkIntegrity({
      repoPath: repo, baseSha, originalHead: originalSha, companionHead: companionSha,
    })
    expect(result.ok).toBe(true)
  })

  it("fails when trees differ", async () => {
    // Make companion's tree differ
    await execa("git", ["checkout", "-q", "companion"], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "base\nmore\nextra\n")
    await execa("git", ["commit", "-q", "-am", "drift"], { cwd: repo })
    const drifted = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
    const result = await checkIntegrity({
      repoPath: repo, baseSha, originalHead: originalSha, companionHead: drifted,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/tree/)
  })
})
