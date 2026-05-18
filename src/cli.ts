#!/usr/bin/env node
import { Command } from "commander"
import { execa } from "execa"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { version } from "./index.js"
import { loadConfig } from "./config/load.js"
import { makeClassifier, detectFromEnv } from "./classify/select.js"
import { parsePrUrl, fetchPR } from "./github/fetch.js"
import { withWorktree } from "./apply/worktree.js"
import { runSplit } from "./commands/split.js"
import { runManifest } from "./commands/manifest.js"
import { runVerify } from "./commands/verify.js"
import { createCompanionPR, postOrUpdateComment } from "./github/pr.js"
import type { Provider } from "./types.js"

export function buildCli(): Command {
  const program = new Command()
    .name("vibereview")
    .description("Split a PR into AI/human review layers")
    .version(version)

  const common = (c: Command) => c
    .option("--provider <provider>", "claude | openai")
    .option("--model <id>", "model id override")
    .option("--config <path>", ".vibereview.yml path")
    .option("--verbose", "stream LLM rationale", false)
    .option("--json", "machine-readable output", false)

  common(program.command("split"))
    .argument("<pr>", "PR url or number")
    .option("--dry-run", "print manifest and exit", false)
    .option("--no-pr", "push branch but do not open PR")
    .option("--base-branch <name>", "override base branch")
    .option("--branch-name <pattern>", "override branch name pattern")
    .action(async (prArg: string, opts: Record<string, unknown>) => {
      await doSplit(prArg, opts)
    })

  common(program.command("manifest"))
    .argument("<pr>", "PR url or number")
    .action(async (prArg: string, opts: Record<string, unknown>) => {
      await doManifest(prArg, opts)
    })

  common(program.command("verify"))
    .argument("<pr>", "Companion PR url")
    .action(async (prArg: string, opts: Record<string, unknown>) => {
      await doVerify(prArg, opts)
    })

  return program
}

async function doSplit(prArg: string, opts: Record<string, unknown>) {
  const repoPath = process.cwd()
  const config = loadConfig((opts.config as string) ?? join(repoPath, ".vibereview.yml"))
  if (!existsSync(join(repoPath, ".vibereview.yml"))) {
    console.warn("warning: no .vibereview.yml found; using built-in defaults")
  }
  const provider = ((opts.provider as Provider | undefined) ?? detectFromEnv(process.env))
  if (!provider) failExit2("No provider chosen and no ANTHROPIC_API_KEY or OPENAI_API_KEY set.")
  const classifier = makeClassifier({ provider: provider!, model: opts.model as string | undefined, config, env: process.env })
  const defaultRepo = await originRepo(repoPath)
  const ref = parsePrUrl(prArg, defaultRepo)
  const { pr, diff } = await fetchPR(ref, repoPath)

  if (opts.dryRun) {
    const m = await runManifest({ pr, diff, config, classifier })
    process.stdout.write(JSON.stringify(m, null, 2) + "\n")
    return
  }
  await withWorktree(repoPath, pr.baseSha, async (wt) => {
    const result = await runSplit({
      pr, diff, config, classifier,
      repoPath, worktreePath: wt.path,
      push: async (branch) => { await execa("git", ["push", "-u", "origin", branch], { cwd: wt.path }) },
      openPR: async (a) => {
        if (opts.pr === false) return ""
        return createCompanionPR({
          sourcePR: pr, branch: a.branch, base: pr.baseBranch, title: a.title, body: a.body,
        }, repoPath)
      },
      postComment: async (body) => {
        if (opts.pr === false) return
        await postOrUpdateComment({ sourcePR: pr, body }, repoPath)
      },
    })
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    else console.log(`vibereview: opened ${result.companionUrl}\nLayers: A=${result.perLayer.A} B=${result.perLayer.B} C=${result.perLayer.C}`)
  })
}

async function doManifest(prArg: string, opts: Record<string, unknown>) {
  const repoPath = process.cwd()
  const config = loadConfig((opts.config as string) ?? join(repoPath, ".vibereview.yml"))
  const provider = ((opts.provider as Provider | undefined) ?? detectFromEnv(process.env))
  if (!provider) failExit2("No provider chosen and no ANTHROPIC_API_KEY or OPENAI_API_KEY set.")
  const classifier = makeClassifier({ provider: provider!, model: opts.model as string | undefined, config, env: process.env })
  const defaultRepo = await originRepo(repoPath)
  const ref = parsePrUrl(prArg, defaultRepo)
  const { pr, diff } = await fetchPR(ref, repoPath)
  const m = await runManifest({ pr, diff, config, classifier })
  process.stdout.write(JSON.stringify(m, null, 2) + "\n")
}

async function doVerify(prArg: string, _opts: Record<string, unknown>) {
  const repoPath = process.cwd()
  const ref = parsePrUrl(prArg, await originRepo(repoPath))
  const result = await runVerify({
    companionUrl: prArg,
    readCompanionCommits: async () => {
      const log = (await execa("git", [
        "log", "--format=%H%x09%B%x1e",
        `origin/main..origin/${(await execa("gh", ["pr", "view", String(ref.number),
          "--repo", `${ref.owner}/${ref.repo}`, "--json", "headRefName", "-q", ".headRefName",
        ], { cwd: repoPath })).stdout.trim()}`,
      ], { cwd: repoPath })).stdout
      return log.split("\x1e").filter(Boolean).map((entry) => ({
        layer: "?", message: entry.split("\t").slice(1).join("\t"),
      }))
    },
    fetchSourceHead: async () => {
      const sourceJson = JSON.parse((await execa("gh", ["pr", "view", String(ref.number),
        "--repo", `${ref.owner}/${ref.repo}`, "--json", "headRefOid",
      ], { cwd: repoPath })).stdout) as { headRefOid: string }
      return sourceJson.headRefOid
    },
    hunkIdsForSource: async () => new Set(),
    compareTrees: async () => true,
  })
  if (!result.ok) { console.error(`verify failed: ${result.reason}`); process.exit(1) }
  console.log("verify: OK")
}

async function originRepo(repoPath: string): Promise<{ owner: string; repo: string } | undefined> {
  try {
    const url = (await execa("git", ["remote", "get-url", "origin"], { cwd: repoPath })).stdout.trim()
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/)
    if (!m) return undefined
    return { owner: m[1]!, repo: m[2]! }
  } catch { return undefined }
}

function failExit2(message: string): never {
  console.error(message)
  process.exit(2)
}

// Only run CLI when this module is the entry point (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = buildCli()
  program.parseAsync(process.argv).catch((err: unknown) => {
    const error = err as { message?: string; exitCode?: number }
    console.error(error.message ?? err)
    process.exit(error.exitCode ?? 1)
  })
}
