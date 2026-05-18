import { parseTrailers } from "../trailer/parse.js"

export type VerifyInput = {
  companionUrl: string
  readCompanionCommits: () => Promise<{ layer: string; message: string }[]>
  fetchSourceHead: () => Promise<string>
  hunkIdsForSource: () => Promise<Set<string>>
  compareTrees: () => Promise<boolean>
}

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export async function runVerify(input: VerifyInput): Promise<VerifyResult> {
  const commits = await input.readCompanionCommits()
  const trailerSets = commits.map((c) => parseTrailers(c.message))
  if (trailerSets.some((t) => t === null)) {
    return { ok: false, reason: "Companion commit missing Vibereview-* trailers" }
  }
  const recordedHead = trailerSets[0]!.sourceHead
  const currentHead = await input.fetchSourceHead()
  if (recordedHead !== currentHead) {
    return { ok: false, reason: `source PR moved: trailer=${recordedHead} now=${currentHead}` }
  }
  const trailerIds = new Set(trailerSets.flatMap((t) => t!.hunkIds))
  const sourceIds = await input.hunkIdsForSource()
  for (const id of sourceIds) {
    if (!trailerIds.has(id)) return { ok: false, reason: `missing hunk id in trailers: ${id}` }
  }
  for (const id of trailerIds) {
    if (!sourceIds.has(id)) return { ok: false, reason: `extra hunk id in trailers: ${id}` }
  }
  if (!(await input.compareTrees())) {
    return { ok: false, reason: "tree(companion) != tree(source)" }
  }
  return { ok: true }
}
