import type { Classifier, ClassifyResponse, Usage } from "./classifier.js"
import type { Hunk } from "../hunkify/types.js"
import type { Classification } from "../promote/types.js"

export type BatchOpts = {
  maxPerBatch: number
  maxTokensPerBatch: number
  estimate: (text: string) => number
}

export function batchHunks(hunks: Hunk[], opts: BatchOpts): Hunk[][] {
  const batches: Hunk[][] = []
  let current: Hunk[] = []
  let currentTokens = 0
  for (const h of hunks) {
    const cost = opts.estimate(JSON.stringify({ id: h.id, file: h.file, diff: h.body }))
    const wouldOverflow =
      current.length >= opts.maxPerBatch ||
      (current.length > 0 && currentTokens + cost > opts.maxTokensPerBatch)
    if (wouldOverflow) {
      batches.push(current)
      current = []
      currentTokens = 0
    }
    current.push(h)
    currentTokens += cost
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export type ClassifyAllArgs = {
  hunks: Hunk[]
  classifier: Classifier
  systemPrompt: string
  maxPerBatch: number
  maxTokensPerBatch: number
  onProgress?: (msg: string) => void
}

export async function classifyAll(args: ClassifyAllArgs): Promise<ClassifyResponse> {
  const batches = batchHunks(args.hunks, {
    maxPerBatch: args.maxPerBatch,
    maxTokensPerBatch: args.maxTokensPerBatch,
    estimate: (s) => args.classifier.estimateTokens(s),
  })
  const all: Classification[] = []
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

  args.onProgress?.(`classifying ${args.hunks.length} hunks in ${batches.length} batches`)

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    let result = await args.classifier.classify({
      systemPrompt: args.systemPrompt, hunks: batch,
    })
    accUsage(usage, result.usage)

    let missing = findMissing(batch, result.classifications)
    if (missing.length > 0) {
      const retry = await args.classifier.classify({
        systemPrompt: args.systemPrompt + "\n\nRETRY: missing ids — " + missing.join(","),
        hunks: batch,
      })
      accUsage(usage, retry.usage)
      const retryForMissing = retry.classifications.filter((c) => missing.includes(c.hunk_id))
      result = {
        classifications: [...result.classifications, ...retryForMissing],
        usage: retry.usage,
      }
      missing = findMissing(batch, result.classifications)
      if (missing.length > 0) {
        throw new Error(`Classifier missing hunk ids after retry: ${missing.join(",")}`)
      }
    }
    all.push(...result.classifications)
    args.onProgress?.(
      `  batch ${i + 1}/${batches.length} classified (${batch.length} hunks, ${formatBatchUsage(result.usage)})`,
    )
  }

  return { classifications: all, usage }
}

function formatBatchUsage(u: Usage): string {
  const parts = [`${formatTokens(u.inputTokens)} in / ${formatTokens(u.outputTokens)} out`]
  if (u.cacheReadTokens && u.cacheReadTokens > 0) parts.push(`cache hit ${formatTokens(u.cacheReadTokens)}`)
  if (u.cacheWriteTokens && u.cacheWriteTokens > 0) parts.push(`cache write ${formatTokens(u.cacheWriteTokens)}`)
  return parts.join(", ")
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

function findMissing(batch: Hunk[], classifications: Classification[]): string[] {
  const got = new Set(classifications.map((c) => c.hunk_id))
  return batch.filter((h) => !got.has(h.id)).map((h) => h.id)
}

function accUsage(into: Usage, from: Usage): void {
  into.inputTokens += from.inputTokens
  into.outputTokens += from.outputTokens
  into.cacheReadTokens = (into.cacheReadTokens ?? 0) + (from.cacheReadTokens ?? 0)
  into.cacheWriteTokens = (into.cacheWriteTokens ?? 0) + (from.cacheWriteTokens ?? 0)
}
