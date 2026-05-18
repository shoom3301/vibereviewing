import { git } from "./exec.js"

export async function treeHash(cwd: string, ref: string): Promise<string> {
  return (await git(["rev-parse", `${ref}^{tree}`], { cwd })).trim()
}

export async function diffRange(cwd: string, from: string, to: string): Promise<string> {
  return git(["diff", "--no-color", `${from}..${to}`], { cwd })
}

export async function headSha(cwd: string): Promise<string> {
  return (await git(["rev-parse", "HEAD"], { cwd })).trim()
}
