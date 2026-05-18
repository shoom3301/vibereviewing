import { execa } from "execa"
import type { PRRef } from "../types.js"

export type ParsedPrRef = { owner: string; repo: string; number: number }

export function parsePrUrl(input: string, defaultRepo?: { owner: string; repo: string }): ParsedPrRef {
  const urlMatch = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
  if (urlMatch) {
    return { owner: urlMatch[1]!, repo: urlMatch[2]!, number: Number(urlMatch[3]!) }
  }
  const numMatch = input.match(/^\d+$/)
  if (numMatch && defaultRepo) {
    return { ...defaultRepo, number: Number(input) }
  }
  throw new Error(`Cannot parse PR reference: ${input}`)
}

export type FetchPRResult = { pr: PRRef; diff: string }

export type FetchPRFromCommandsArgs = {
  ref: ParsedPrRef
  runGh: (args: string[]) => Promise<string>
  runGitDiff: (baseSha: string, headSha: string) => Promise<string>
}

export async function fetchPRFromCommands(a: FetchPRFromCommandsArgs): Promise<FetchPRResult> {
  const json = await a.runGh([
    "api", `repos/${a.ref.owner}/${a.ref.repo}/pulls/${a.ref.number}`,
  ])
  const parsed = JSON.parse(json) as {
    number: number; title: string; html_url: string;
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
  }
  const diff = await a.runGitDiff(parsed.base.sha, parsed.head.sha)
  return {
    pr: {
      owner: a.ref.owner, repo: a.ref.repo,
      number: parsed.number, title: parsed.title,
      baseBranch: parsed.base.ref,
      baseSha: parsed.base.sha,
      headSha: parsed.head.sha,
      url: parsed.html_url,
    },
    diff,
  }
}

export async function fetchPR(ref: ParsedPrRef, repoPath: string): Promise<FetchPRResult> {
  return fetchPRFromCommands({
    ref,
    runGh: async (args) => (await execa("gh", args, { cwd: repoPath })).stdout,
    runGitDiff: async (base, head) => {
      await execa("git", ["fetch", "origin", base, head], { cwd: repoPath, reject: false })
      return (await execa("git", ["diff", "--no-color", `${base}..${head}`], { cwd: repoPath })).stdout
    },
  })
}
