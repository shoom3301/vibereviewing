import { execa } from "execa"
import { COMMENT_MARKER } from "../render/comment.js"

export type CreatePRArgs = {
  runGh: (args: string[]) => Promise<string>
  sourcePR: { owner: string; repo: string; number: number }
  branch: string
  base: string
  title: string
  body: string
}

export async function createCompanionPRFromCommands(a: CreatePRArgs): Promise<string> {
  const out = await a.runGh([
    "pr", "create",
    "--repo", `${a.sourcePR.owner}/${a.sourcePR.repo}`,
    "--base", a.base,
    "--head", a.branch,
    "--title", a.title,
    "--body", a.body,
    "--draft",
  ])
  return out.trim()
}

export type PostCommentArgs = {
  runGhJson: (args: string[]) => Promise<string>   // gh api ... (returns json)
  runGh:     (args: string[]) => Promise<string>   // gh api -X POST/PATCH
  sourcePR: { owner: string; repo: string; number: number }
  body: string
}

export async function postOrUpdateCommentFromCommands(a: PostCommentArgs): Promise<void> {
  const listed = await a.runGhJson([
    "api", `/repos/${a.sourcePR.owner}/${a.sourcePR.repo}/issues/${a.sourcePR.number}/comments`,
  ])
  const comments = JSON.parse(listed) as Array<{ id: number; body: string }>
  const existing = comments.find((c) => c.body.includes(COMMENT_MARKER))
  if (existing) {
    await a.runGh([
      "api", `/repos/${a.sourcePR.owner}/${a.sourcePR.repo}/issues/comments/${existing.id}`,
      "-X", "PATCH", "-f", `body=${a.body}`,
    ])
    return
  }
  await a.runGh([
    "api", `/repos/${a.sourcePR.owner}/${a.sourcePR.repo}/issues/${a.sourcePR.number}/comments`,
    "-X", "POST", "-f", `body=${a.body}`,
  ])
}

export async function createCompanionPR(args: Omit<CreatePRArgs, "runGh">, repoPath: string): Promise<string> {
  return createCompanionPRFromCommands({
    ...args,
    runGh: async (a) => String((await execa("gh", a, { cwd: repoPath })).stdout),
  })
}

export async function postOrUpdateComment(args: Omit<PostCommentArgs, "runGh" | "runGhJson">, repoPath: string): Promise<void> {
  await postOrUpdateCommentFromCommands({
    ...args,
    runGhJson: async (a) => String((await execa("gh", a, { cwd: repoPath })).stdout),
    runGh:     async (a) => String((await execa("gh", a, { cwd: repoPath })).stdout),
  })
}
