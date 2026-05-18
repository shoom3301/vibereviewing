import type { PRRef, Layer, Intent } from "../types.js"
import type { Classifier } from "../classify/classifier.js"
import type { Config } from "../config/schema.js"
import type { EscalationReason } from "../promote/types.js"
import { parseDiff } from "../hunkify/parse.js"
import { applyContext } from "../hunkify/context.js"
import { buildSystemPrompt } from "../classify/prompt.js"
import { classifyAll } from "../classify/batch.js"
import { promote } from "../promote/pipeline.js"

export type ManifestEntry = {
  hunk_id: string
  file: string
  line: number
  layer: Layer
  original_layer: Layer
  confidence: number
  intents: Intent[]
  rationale: string
  escalations: EscalationReason[]
}

export type Manifest = {
  pr: PRRef
  entries: ManifestEntry[]
}

export async function runManifest(args: {
  pr: PRRef; diff: string; config: Config; classifier: Classifier
}): Promise<Manifest> {
  const files = parseDiff(args.diff)
  applyContext(files, { floors: args.config.floors, generated: args.config.generated })
  const hunks = files.flatMap((f) => f.hunks)
  const systemPrompt = buildSystemPrompt({ config: args.config })
  const { classifications } = await classifyAll({
    hunks, classifier: args.classifier, systemPrompt,
    maxPerBatch: 30, maxTokensPerBatch: 30_000,
  })
  const promoted = promote({
    files, hunks,
    classifications: new Map(classifications.map((c) => [c.hunk_id, c])),
    confidenceThreshold: args.config.confidence_threshold,
  })
  const fileOf = (id: string) =>
    files.find((f) => f.hunks.some((h) => h.id === id))?.file ?? "?"
  const lineOf = (id: string) =>
    files.flatMap((f) => f.hunks).find((h) => h.id === id)?.newStart ?? 0
  return {
    pr: args.pr,
    entries: [...promoted.values()].map((p) => ({
      hunk_id: p.hunk_id,
      file: fileOf(p.hunk_id),
      line: lineOf(p.hunk_id),
      layer: p.layer,
      original_layer: p.originalLayer,
      confidence: p.confidence,
      intents: p.intents,
      rationale: p.rationale,
      escalations: p.escalations,
    })),
  }
}
