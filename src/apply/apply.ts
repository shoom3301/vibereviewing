import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execa } from "execa"

export type ApplyResult = {
  applied: boolean
  rejectedHunks: { file: string; hunkHeader: string }[]
  stderr: string
}

export async function applyPatchOrEscalate(cwd: string, patch: string): Promise<ApplyResult> {
  if (patch.trim().length === 0) {
    return { applied: true, rejectedHunks: [], stderr: "" }
  }
  const patchDir = mkdtempSync(join(tmpdir(), "vibereview-patch-"))
  const patchFile = join(patchDir, "layer.patch")
  writeFileSync(patchFile, patch)
  try {
    const tryThreeWay = await execa("git", ["apply", "--3way", "--whitespace=nowarn", patchFile], {
      cwd,
      reject: false,
    })
    if (tryThreeWay.exitCode === 0) {
      return { applied: true, rejectedHunks: [], stderr: "" }
    }
    const tryPlain = await execa("git", ["apply", "--reject", "--whitespace=nowarn", patchFile], {
      cwd,
      reject: false,
    })
    const combined = (tryPlain.stderr ?? "") + "\n" + (tryThreeWay.stderr ?? "")
    const rejectedHunks = parseRejects(combined)
    return {
      applied: tryPlain.exitCode === 0,
      rejectedHunks,
      stderr: tryThreeWay.stderr ?? "",
    }
  } finally {
    rmSync(patchDir, { recursive: true, force: true })
  }
}

function parseRejects(stderr: string): { file: string; hunkHeader: string }[] {
  const out: { file: string; hunkHeader: string }[] = []
  // Match "error: patch failed: <file>:<line>"
  const re = /error: patch failed: ([^\n:]+):(\d+)/g
  for (const m of stderr.matchAll(re)) {
    out.push({ file: m[1]!, hunkHeader: m[2]! })
  }
  return out
}
