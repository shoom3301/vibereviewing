import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSplit } from "../../../src/commands/split.js"
import { withWorktree } from "../../../src/apply/worktree.js"
import { DEFAULT_CONFIG } from "../../../src/config/load.js"
import type { Classifier } from "../../../src/classify/classifier.js"
import type { Classification } from "../../../src/promote/types.js"

describe("runSplit", () => {
  let repo: string
  let baseSha: string
  let headSha: string

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-split-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "a.txt"), "hello\nworld\n")
    writeFileSync(join(repo, "b.ts"), "export function foo(){return 1}\n")
    await execa("git", ["add", "."], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "base"], { cwd: repo })
    baseSha = String((await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout).trim()
    writeFileSync(join(repo, "a.txt"), "hello\nworld!\n")
    writeFileSync(join(repo, "b.ts"),
      "export function foo(){return 2}\nexport function bar(){return 99}\n")
    await execa("git", ["commit", "-q", "-am", "pr"], { cwd: repo })
    headSha = String((await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout).trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  function fakeClassifier(map: (id: string) => Partial<Classification>): Classifier {
    return {
      provider: "claude", model: "fake",
      estimateTokens: (s) => Math.ceil(s.length / 4),
      classify: async ({ hunks }) => ({
        classifications: hunks.map((h) => ({
          hunk_id: h.id,
          layer: "A", confidence: 0.95, intents: ["typo"], rationale: "fake",
          ...map(h.id),
        }) as Classification),
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    }
  }

  it("produces a companion branch whose tree matches the original head", async () => {
    const diff = String((await execa("git", ["diff", "--no-color", `${baseSha}..${headSha}`], { cwd: repo })).stdout)
    const result = await withWorktree(repo, baseSha, (wt) =>
      runSplit({
        pr: {
          owner: "x", repo: "y", number: 1, title: "t",
          baseBranch: "main", baseSha, headSha,
          url: "https://github.com/x/y/pull/1",
        },
        diff, config: DEFAULT_CONFIG,
        classifier: fakeClassifier(() => ({ layer: "A" })),
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/2",
        postComment: async () => {},
        now: new Date("2026-05-17T14:32:00Z"),
      }),
    )
    expect(result.companionUrl).toBe("https://github.com/x/y/pull/2")
    expect(result.perLayer.A + result.perLayer.B + result.perLayer.C).toBeGreaterThan(0)
  })

  it("emits progress lines for each phase", async () => {
    const diff = String((await execa("git", ["diff", "--no-color", `${baseSha}..${headSha}`], { cwd: repo })).stdout)
    const messages: string[] = []
    await withWorktree(repo, baseSha, (wt) =>
      runSplit({
        pr: {
          owner: "x", repo: "y", number: 42, title: "t",
          baseBranch: "main", baseSha, headSha,
          url: "https://github.com/x/y/pull/42",
        },
        diff, config: DEFAULT_CONFIG,
        classifier: fakeClassifier(() => ({ layer: "A" })),
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/43",
        postComment: async () => {},
        now: new Date("2026-05-17T14:32:00Z"),
        onProgress: (m) => messages.push(m),
      }),
    )
    expect(messages.some((m) => /^parsed \d+ files?, \d+ hunks?$/.test(m))).toBe(true)
    expect(messages).toContain("classifying 2 hunks in 1 batches")
    expect(messages.some((m) => /^applying layer A/.test(m))).toBe(true)
    expect(messages).toContain("verifying integrity")
    expect(messages).toContain("writing manifest")
    expect(messages.some((m) => /^pushing branch /.test(m))).toBe(true)
    expect(messages).toContain("opening companion PR")
  })

  it("rejects PRs whose diff exceeds max_diff_tokens", async () => {
    const diff = String((await execa("git", ["diff", "--no-color", `${baseSha}..${headSha}`], { cwd: repo })).stdout)
    await withWorktree(repo, baseSha, async (wt) => {
      await expect(runSplit({
        pr: {
          owner: "x", repo: "y", number: 1, title: "t",
          baseBranch: "main", baseSha, headSha,
          url: "https://github.com/x/y/pull/1",
        },
        diff,
        config: { ...DEFAULT_CONFIG, max_diff_tokens: 1 },
        classifier: fakeClassifier(() => ({ layer: "A" })),
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/2",
        postComment: async () => {},
      })).rejects.toThrow(/max_diff_tokens/)
    })
  })
})
