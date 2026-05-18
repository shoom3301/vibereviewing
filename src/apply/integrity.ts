import { diffRange, treeHash } from "../git/checks.js"

export type IntegrityArgs = {
  repoPath: string
  baseSha: string
  originalHead: string
  companionHead: string
}

export type IntegrityResult = { ok: true } | { ok: false; reason: string }

export async function checkIntegrity(a: IntegrityArgs): Promise<IntegrityResult> {
  const [treeOrig, treeComp] = await Promise.all([
    treeHash(a.repoPath, a.originalHead),
    treeHash(a.repoPath, a.companionHead),
  ])
  if (treeOrig !== treeComp) {
    return { ok: false, reason: `tree mismatch: original=${treeOrig} companion=${treeComp}` }
  }
  const [diffOrig, diffComp] = await Promise.all([
    diffRange(a.repoPath, a.baseSha, a.originalHead),
    diffRange(a.repoPath, a.baseSha, a.companionHead),
  ])
  if (diffOrig !== diffComp) {
    return { ok: false, reason: "diff (base..head) bytes differ between original and companion" }
  }
  return { ok: true }
}
