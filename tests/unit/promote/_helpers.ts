import type { Classification, PromoteContext, PromotedClassification } from "../../../src/promote/types.js"
import type { Hunk, FileChange } from "../../../src/hunkify/types.js"
import type { Layer } from "../../../src/types.js"

export function makeClassification(c: Partial<Classification>): Classification {
  return {
    hunk_id: c.hunk_id ?? "h_1",
    layer: c.layer ?? "A",
    confidence: c.confidence ?? 0.95,
    intents: c.intents ?? ["typo"],
    rationale: c.rationale ?? "",
  }
}

export function makeHunk(
  file: string,
  body: string,
  id: string,
  opts: { floor?: Layer; isGenerated?: boolean } = {},
): Hunk {
  return {
    id, file, oldPath: null,
    oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body,
    isBinary: false, isRename: false, isDelete: false,
    isSubmodule: false, isModeChange: false,
    context: {
      fileLanguage: file.split(".").pop() ?? "text",
      isGenerated: opts.isGenerated ?? false,
      domainFloor: opts.floor ?? "A",
    },
  }
}

export function makeFile(path: string, hunks: Hunk[]): FileChange {
  return {
    file: path, oldPath: null, language: path.split(".").pop() ?? "text",
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false, hunks,
  }
}

export function makeContext(
  files: FileChange[],
  classifications: Classification[],
  threshold = 0.7,
): PromoteContext {
  const hunks = files.flatMap((f) => f.hunks)
  return {
    files, hunks,
    classifications: new Map(classifications.map((c) => [c.hunk_id, c])),
    confidenceThreshold: threshold,
  }
}

export function seedResult(ctx: PromoteContext): Map<string, PromotedClassification> {
  const out = new Map<string, PromotedClassification>()
  for (const [id, cl] of ctx.classifications) {
    out.set(id, { ...cl, originalLayer: cl.layer, escalations: [] })
  }
  return out
}
