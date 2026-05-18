import { describe, it, expect, vi } from "vitest"
import { classifyAll, batchHunks } from "../../../src/classify/batch.js"
import type { BatchCache, CachedBatchResult } from "../../../src/classify/cache.js"
import type { Classifier } from "../../../src/classify/classifier.js"
import type { Hunk } from "../../../src/hunkify/types.js"

function fakeHunk(id: string): Hunk {
  return {
    id, file: `src/${id}.ts`, oldPath: null,
    oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body: "@@",
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false, isModeChange: false,
    context: { fileLanguage: "ts", isGenerated: false, domainFloor: "A" },
  }
}

function classifierThatReturns(
  fn: (ids: string[]) => string[],
): Classifier {
  return {
    provider: "claude", model: "test",
    estimateTokens: (s) => Math.ceil(s.length / 4),
    classify: vi.fn(async ({ hunks }) => ({
      classifications: fn(hunks.map((h) => h.id)).map((id) => ({
        hunk_id: id, layer: "A" as const, confidence: 0.9,
        intents: ["typo" as const], rationale: "",
      })),
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  }
}

describe("batchHunks", () => {
  it("splits hunks into batches respecting maxPerBatch", () => {
    const hunks = Array.from({ length: 10 }, (_, i) => fakeHunk(`h_${i}`))
    const batches = batchHunks(hunks, { maxPerBatch: 4, maxTokensPerBatch: 1e9, estimate: () => 0 })
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(4)
    expect(batches[2]).toHaveLength(2)
  })

  it("starts a new batch when token budget would be exceeded", () => {
    const hunks = Array.from({ length: 4 }, (_, i) => fakeHunk(`h_${i}`))
    const batches = batchHunks(hunks, {
      maxPerBatch: 100, maxTokensPerBatch: 100, estimate: () => 60,
    })
    expect(batches).toHaveLength(4)  // each hunk solo because 60+60 > 100
  })
})

describe("classifyAll", () => {
  it("returns classifications for every hunk", async () => {
    const hunks = Array.from({ length: 5 }, (_, i) => fakeHunk(`h_${i}`))
    const c = classifierThatReturns((ids) => ids)
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 3, maxTokensPerBatch: 1e9,
    })
    expect(out.classifications).toHaveLength(5)
    expect(c.classify).toHaveBeenCalledTimes(2)
  })

  it("re-prompts with only the missing hunks", async () => {
    const hunks = Array.from({ length: 3 }, (_, i) => fakeHunk(`h_${i}`))
    let call = 0
    const seenHunkIds: string[][] = []
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => {
        call++
        const ids = input.map((h) => h.id)
        seenHunkIds.push(ids)
        const returned = call === 1 ? ids.slice(0, 1) : ids
        return {
          classifications: returned.map((id) => ({
            hunk_id: id, layer: "A" as const, confidence: 0.9,
            intents: ["typo" as const], rationale: "",
          })),
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      }),
    }
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
    })
    expect(out.classifications).toHaveLength(3)
    expect(seenHunkIds[0]).toEqual(["h_0", "h_1", "h_2"])
    // Focused retry should ask for ONLY the 2 missing ones, not all 3
    expect(seenHunkIds[1]).toEqual(["h_1", "h_2"])
  })

  it("forces unclassified hunks to layer C after focused retries exhaust", async () => {
    const hunks = [fakeHunk("h_0"), fakeHunk("h_1")]
    // Classifier always returns only h_0, never h_1 — even when asked for only h_1.
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async () => ({
        classifications: [{
          hunk_id: "h_0", layer: "A" as const, confidence: 0.9,
          intents: ["typo" as const], rationale: "",
        }],
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    }
    const messages: string[] = []
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      onProgress: (m) => messages.push(m),
    })
    expect(out.classifications).toHaveLength(2)
    const h1 = out.classifications.find((c) => c.hunk_id === "h_1")!
    expect(h1.layer).toBe("C")
    expect(h1.confidence).toBe(0)
    expect(h1.intents).toEqual(["unknown"])
    expect(messages.some((m) => /forcing 1 unclassified hunks to layer C/.test(m))).toBe(true)
  })

  it("invokes onProgress with batch start and completion", async () => {
    const hunks = Array.from({ length: 7 }, (_, i) => fakeHunk(`h_${i}`))
    const c = classifierThatReturns((ids) => ids)
    const messages: string[] = []
    await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 3, maxTokensPerBatch: 1e9,
      onProgress: (m) => messages.push(m),
    })
    // 7 hunks at maxPerBatch=3 => 3 batches. Fake classifier returns 1 in / 1 out per call.
    expect(messages).toEqual([
      "classifying 7 hunks in 3 batches",
      "  batch 1/3 classified (3 hunks, 1 in / 1 out)",
      "  batch 2/3 classified (3 hunks, 1 in / 1 out)",
      "  batch 3/3 classified (1 hunks, 1 in / 1 out)",
    ])
  })

  it("includes cache stats and uses k-suffix for large counts", async () => {
    const hunks = [fakeHunk("h_0")]
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => ({
        classifications: input.map((h) => ({
          hunk_id: h.id, layer: "A" as const, confidence: 0.9,
          intents: ["typo" as const], rationale: "",
        })),
        usage: {
          inputTokens: 1234, outputTokens: 567,
          cacheReadTokens: 800, cacheWriteTokens: 0,
        },
      })),
    }
    const messages: string[] = []
    await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      onProgress: (m) => messages.push(m),
    })
    expect(messages).toContain("  batch 1/1 classified (1 hunks, 1.2k in / 567 out, cache hit 800)")
  })

  it("does nothing when onProgress is omitted", async () => {
    const hunks = [fakeHunk("h_0")]
    const c = classifierThatReturns((ids) => ids)
    await expect(classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
    })).resolves.toBeDefined()
  })

  it("retries on transient network errors and succeeds", async () => {
    const hunks = [fakeHunk("h_0")]
    let calls = 0
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => {
        calls++
        if (calls < 3) {
          const err = new Error("Connection error.") as Error & { name: string }
          err.name = "APIConnectionError"
          throw err
        }
        return {
          classifications: input.map((h) => ({
            hunk_id: h.id, layer: "A" as const, confidence: 0.9,
            intents: ["typo" as const], rationale: "",
          })),
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      }),
    }
    const messages: string[] = []
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      maxAttemptsPerBatch: 3,
      retryBackoffMs: () => 0,
      onProgress: (m) => messages.push(m),
    })
    expect(out.classifications).toHaveLength(1)
    expect(calls).toBe(3)
    expect(messages.some((m) => /retrying in 0s \(attempt 2\/3\)/.test(m))).toBe(true)
    expect(messages.some((m) => /retrying in 0s \(attempt 3\/3\)/.test(m))).toBe(true)
  })

  it("does not retry non-retryable errors (e.g. auth)", async () => {
    const hunks = [fakeHunk("h_0")]
    let calls = 0
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async () => {
        calls++
        const err = new Error("Invalid API key") as Error & { name: string; status: number }
        err.name = "AuthenticationError"
        err.status = 401
        throw err
      }),
    }
    await expect(classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      maxAttemptsPerBatch: 3,
      retryBackoffMs: () => 0,
    })).rejects.toThrow(/Invalid API key/)
    expect(calls).toBe(1)
  })

  it("retries 5xx status errors", async () => {
    const hunks = [fakeHunk("h_0")]
    let calls = 0
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => {
        calls++
        if (calls === 1) {
          const err = new Error("Internal server error") as Error & { status: number }
          err.status = 503
          throw err
        }
        return {
          classifications: input.map((h) => ({
            hunk_id: h.id, layer: "A" as const, confidence: 0.9,
            intents: ["typo" as const], rationale: "",
          })),
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      }),
    }
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      maxAttemptsPerBatch: 3,
      retryBackoffMs: () => 0,
    })
    expect(out.classifications).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it("retries when SDK throws a real APIConnectionError subclass (name unset)", async () => {
    // Mirror the actual @anthropic-ai/sdk and openai SDKs: subclass of Error
    // with no `this.name = ...` — JS leaves `.name === "Error"`, so we must
    // identify the error by constructor.name instead.
    class APIConnectionError extends Error {
      constructor(message: string) { super(message) }
    }
    const hunks = [fakeHunk("h_0")]
    let calls = 0
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => {
        calls++
        if (calls === 1) throw new APIConnectionError("Connection error.")
        return {
          classifications: input.map((h) => ({
            hunk_id: h.id, layer: "A" as const, confidence: 0.9,
            intents: ["typo" as const], rationale: "",
          })),
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      }),
    }
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      maxAttemptsPerBatch: 3,
      retryBackoffMs: () => 0,
    })
    expect(out.classifications).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it("skips classifier calls for cached batches and emits a cached progress line", async () => {
    const hunks = Array.from({ length: 6 }, (_, i) => fakeHunk(`h_${i}`))
    const classifier = classifierThatReturns((ids) => ids)
    // Two batches of 3. Pre-cache the first batch's result.
    const cacheStore = new Map<string, CachedBatchResult>()
    const cache: BatchCache = {
      lookup: (ids) => cacheStore.get([...ids].sort().join(",")),
      record: (ids, r) => { cacheStore.set([...ids].sort().join(","), r) },
    }
    cache.record(["h_0", "h_1", "h_2"], {
      classifications: ["h_0", "h_1", "h_2"].map((id) => ({
        hunk_id: id, layer: "A" as const, confidence: 0.9,
        intents: ["typo" as const], rationale: "cached",
      })),
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    const messages: string[] = []
    const out = await classifyAll({
      hunks, classifier, systemPrompt: "sys",
      maxPerBatch: 3, maxTokensPerBatch: 1e9,
      cache, onProgress: (m) => messages.push(m),
    })
    expect(out.classifications).toHaveLength(6)
    // First batch was cached → classifier called once (for batch 2 only)
    expect(classifier.classify).toHaveBeenCalledTimes(1)
    expect(messages).toContain("  batch 1/2 cached (3 hunks)")
    // The second batch should be recorded into the cache.
    expect(cacheStore.size).toBe(2)
  })

  it("throws enriched error with batch context after exhausting retries", async () => {
    const hunks = [fakeHunk("h_0"), fakeHunk("h_1")]
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async () => {
        const err = new Error("Connection error.") as Error & { name: string }
        err.name = "APIConnectionError"
        throw err
      }),
    }
    await expect(classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
      maxAttemptsPerBatch: 2,
      retryBackoffMs: () => 0,
    })).rejects.toThrow(/batch 1\/1 failed after 2 attempts/)
  })
})
