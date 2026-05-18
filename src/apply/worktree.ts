import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gitMaybe, git } from "../git/exec.js"

export type Worktree = { path: string; baseSha: string }

export async function withWorktree<T>(
  repoPath: string,
  baseSha: string,
  fn: (wt: Worktree) => Promise<T>,
): Promise<T> {
  const path = mkdtempSync(join(tmpdir(), "vibereview-wt-"))
  await git(["worktree", "add", "--detach", path, baseSha], { cwd: repoPath })
  try {
    return await fn({ path, baseSha })
  } finally {
    await gitMaybe(["worktree", "remove", "--force", path], { cwd: repoPath })
    rmSync(path, { recursive: true, force: true })
  }
}
