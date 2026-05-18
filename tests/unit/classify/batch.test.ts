import { describe, it, expect, vi } from "vitest"
import { classifyAll, batchHunks } from "../../../src/classify/batch.js"
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

  it("retries once when a batch is missing hunk ids", async () => {
    const hunks = Array.from({ length: 3 }, (_, i) => fakeHunk(`h_${i}`))
    let call = 0
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => {
        call++
        const ids = input.map((h) => h.id)
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
    expect(c.classify).toHaveBeenCalledTimes(2)
  })

  it("throws when retry also misses hunk ids", async () => {
    const hunks = [fakeHunk("h_0"), fakeHunk("h_1")]
    const c = classifierThatReturns((ids) => [ids[0]!])
    await expect(classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
    })).rejects.toThrow(/missing/i)
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
    // 7 hunks at maxPerBatch=3 => 3 batches
    expect(messages).toEqual([
      "classifying 7 hunks in 3 batches",
      "  batch 1/3 classified (3 hunks)",
      "  batch 2/3 classified (3 hunks)",
      "  batch 3/3 classified (1 hunks)",
    ])
  })

  it("does nothing when onProgress is omitted", async () => {
    const hunks = [fakeHunk("h_0")]
    const c = classifierThatReturns((ids) => ids)
    await expect(classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
    })).resolves.toBeDefined()
  })
})
