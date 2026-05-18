import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { execa } from "execa"
import { withWorktree } from "../../src/apply/worktree.js"
import { runSplit } from "../../src/commands/split.js"
import { DEFAULT_CONFIG } from "../../src/config/load.js"
import { parseDiff } from "../../src/hunkify/parse.js"
import type { Classifier } from "../../src/classify/classifier.js"
import type { Classification } from "../../src/promote/types.js"

export async function runFixture(fixtureDir: string): Promise<{
  perLayer: { A: number; B: number; C: number }
  integrityOk: boolean
}> {
  const diff = readFileSync(join(fixtureDir, "source.diff"), "utf8")
  const repo = mkdtempSync(join(tmpdir(), "vibereview-fx-"))
  try {
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })

    const files = parseDiff(diff)
    for (const f of files) {
      if (f.isDelete) {
        // Delete: file existed at base with the "-" lines.
        const baseContent = reconstructBase(f.hunks.map((h) => h.body))
        const target = join(repo, f.oldPath ?? f.file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, baseContent)
      } else if (f.oldPath !== null) {
        // Modification: reconstruct from "-" and " " lines.
        const baseContent = reconstructBase(f.hunks.map((h) => h.body))
        const target = join(repo, f.oldPath)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, baseContent)
      }
      // New file (oldPath null and not delete): nothing to commit at base.
    }
    // Ensure at least one file exists so the initial commit can be created.
    const hasFiles = files.some((f) => !f.isDelete && f.oldPath !== null)
    if (!hasFiles) {
      writeFileSync(join(repo, ".gitkeep"), "")
    }
    await execa("git", ["add", "-A"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "base"], { cwd: repo })
    const baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    // Apply the diff to produce the "original head".
    writeFileSync(join(repo, "_pr.diff"), diff)
    await execa("git", ["apply", "_pr.diff"], { cwd: repo })
    await execa("git", ["rm", "-f", "_pr.diff"], { cwd: repo, reject: false })
    rmSync(join(repo, "_pr.diff"), { force: true })
    await execa("git", ["add", "-A"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "pr"], { cwd: repo })
    const headSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    const classifier = recordedClassifier(fixtureDir)
    const result = await withWorktree(repo, baseSha, (wt) =>
      runSplit({
        pr: {
          owner: "x", repo: "y", number: 1, title: "fx",
          baseBranch: "main", baseSha, headSha, url: "u",
        },
        diff, config: DEFAULT_CONFIG, classifier,
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/2",
        postComment: async () => {},
      }),
    )
    return { perLayer: result.perLayer, integrityOk: true }
  } finally { rmSync(repo, { recursive: true, force: true }) }
}

function reconstructBase(bodies: string[]): string {
  const lines: string[] = []
  for (const body of bodies) {
    for (const line of body.split("\n")) {
      if (line.startsWith("@@")) continue
      if (line.startsWith("-")) lines.push(line.slice(1))
      else if (line.startsWith(" ")) lines.push(line.slice(1))
    }
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "")
}

function recordedClassifier(fixtureDir: string): Classifier {
  const path = join(fixtureDir, "recorded-classifier.json")
  let raw: unknown = {}
  try { raw = JSON.parse(readFileSync(path, "utf8")) } catch { /* use defaults */ }
  const isArray = Array.isArray(raw)
  const obj = (isArray ? {} : raw) as Record<string, Partial<Classification>>
  const arr = (isArray ? raw : []) as Partial<Classification>[]
  return {
    provider: "claude", model: "fixture",
    estimateTokens: (s) => Math.ceil(s.length / 4),
    classify: async ({ hunks }) => ({
      classifications: hunks.map((h, i) => ({
        hunk_id: h.id,
        layer: "A" as const, confidence: 0.95,
        intents: ["typo" as const], rationale: "",
        ...(arr[i] ?? obj[h.id] ?? {}),
      } as Classification)),
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  }
}
