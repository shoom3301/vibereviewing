import type { Classifier, ClassifyRequest, ClassifyResponse, Usage } from "./classifier.js"
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
  maxAttemptsPerBatch?: number
  retryBackoffMs?: (attempt: number) => number
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF = (attempt: number): number => {
  const base = 1000 * Math.pow(2, attempt)  // 2s, 4s, 8s, ...
  const jitter = Math.floor(Math.random() * base * 0.3)
  return base + jitter
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

  const maxAttempts = args.maxAttemptsPerBatch ?? DEFAULT_MAX_ATTEMPTS
  const backoff = args.retryBackoffMs ?? DEFAULT_BACKOFF

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    let result = await attemptClassify(args.classifier, {
      systemPrompt: args.systemPrompt, hunks: batch,
    }, { batchIndex: i, totalBatches: batches.length, maxAttempts, backoff, onProgress: args.onProgress })
    accUsage(usage, result.usage)

    let missing = findMissing(batch, result.classifications)
    if (missing.length > 0) {
      const retry = await attemptClassify(args.classifier, {
        systemPrompt: args.systemPrompt + "\n\nRETRY: missing ids — " + missing.join(","),
        hunks: batch,
      }, { batchIndex: i, totalBatches: batches.length, maxAttempts, backoff, onProgress: args.onProgress })
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

type AttemptContext = {
  batchIndex: number
  totalBatches: number
  maxAttempts: number
  backoff: (attempt: number) => number
  onProgress?: (msg: string) => void
}

async function attemptClassify(
  classifier: Classifier,
  req: ClassifyRequest,
  ctx: AttemptContext,
): Promise<ClassifyResponse> {
  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt++) {
    try {
      return await classifier.classify(req)
    } catch (err) {
      const isLast = attempt === ctx.maxAttempts
      if (isLast || !isRetryableError(err)) {
        const original = err instanceof Error ? err.message : String(err)
        throw new Error(
          `batch ${ctx.batchIndex + 1}/${ctx.totalBatches} failed after ${attempt} attempts: ${original}`,
          { cause: err },
        )
      }
      const waitMs = ctx.backoff(attempt)
      ctx.onProgress?.(
        `  batch ${ctx.batchIndex + 1}/${ctx.totalBatches} ${describeError(err)} — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${ctx.maxAttempts})`,
      )
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw new Error("unreachable")
}

const RETRYABLE_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "InternalServerError",
  "RateLimitError",
  "OverloadedError",
])

function errorClassName(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined
  // The Anthropic and OpenAI SDKs subclass Error but don't set `this.name`,
  // so `err.name` is the default `"Error"`. Identify by constructor name
  // (set by `class X extends Error` declaration) and fall back to `.name`.
  const proto = Object.getPrototypeOf(err) as { constructor?: { name?: string } } | null
  const ctor = proto?.constructor?.name
  if (ctor && ctor !== "Error") return ctor
  const named = (err as { name?: string }).name
  return named && named !== "Error" ? named : undefined
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const cls = errorClassName(err)
  if (cls && RETRYABLE_NAMES.has(cls)) return true
  const e = err as { status?: number; code?: string; cause?: unknown }
  if (typeof e.status === "number") {
    if (e.status === 408 || e.status === 429 || e.status === 529) return true
    if (e.status >= 500 && e.status < 600) return true
  }
  if (e.code === "ECONNRESET" || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT") return true
  // Undici/fetch wraps low-level failures via `cause` — peek through one layer.
  if (e.cause && e.cause !== err) return isRetryableError(e.cause)
  return false
}

function describeError(err: unknown): string {
  if (!err || typeof err !== "object") return "error"
  const cls = errorClassName(err)
  const status = (err as { status?: number }).status
  if (status) return `${cls ?? "error"} (HTTP ${status})`
  if (cls === "APIConnectionError" || cls === "APIConnectionTimeoutError") return "connection error"
  return cls ?? "error"
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
