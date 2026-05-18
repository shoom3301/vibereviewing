import { execa, type Options } from "execa"

export async function git(args: string[], opts: Options = {}): Promise<string> {
  const result = await execa("git", args, { reject: true, ...opts })
  return typeof result.stdout === "string" ? result.stdout : ""
}

export async function gitMaybe(args: string[], opts: Options = {}): Promise<{
  stdout: string; exitCode: number
}> {
  const result = await execa("git", args, { reject: false, ...opts })
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    exitCode: result.exitCode ?? 1,
  }
}
