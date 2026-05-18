import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileBatchCache, hashHunkIds } from "../../../src/classify/cache.js"
import type { Classification } from "../../../src/promote/types.js"

function fakeClassification(id: string): Classification {
  return {
    hunk_id: id, layer: "A", confidence: 0.9,
    intents: ["typo"], rationale: "ok",
  }
}

describe("hashHunkIds", () => {
  it("is stable regardless of input order", () => {
    expect(hashHunkIds(["c", "a", "b"])).toBe(hashHunkIds(["a", "b", "c"]))
  })

  it("differs for different id sets", () => {
    expect(hashHunkIds(["a", "b"])).not.toBe(hashHunkIds(["a", "c"]))
  })
})

describe("FileBatchCache", () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vibereview-cache-"))
    file = join(dir, "cache.json")
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("returns undefined on lookup when no entry exists", () => {
    const cache = new FileBatchCache(file)
    expect(cache.lookup(["h_1", "h_2"])).toBeUndefined()
  })

  it("returns the recorded result on lookup of the same ids", () => {
    const cache = new FileBatchCache(file)
    const result = {
      classifications: [fakeClassification("h_1"), fakeClassification("h_2")],
      usage: { inputTokens: 100, outputTokens: 50 },
    }
    cache.record(["h_1", "h_2"], result)
    expect(cache.lookup(["h_1", "h_2"])).toEqual(result)
    expect(cache.lookup(["h_2", "h_1"])).toEqual(result)  // order-insensitive
  })

  it("persists across instances (file-backed)", () => {
    const c1 = new FileBatchCache(file)
    c1.record(["h_1"], {
      classifications: [fakeClassification("h_1")],
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    const c2 = new FileBatchCache(file)
    expect(c2.lookup(["h_1"])?.classifications[0]?.hunk_id).toBe("h_1")
  })

  it("ignores a corrupted cache file and starts empty", () => {
    writeFileSync(file, "{not json")
    const cache = new FileBatchCache(file)
    expect(cache.lookup(["h_1"])).toBeUndefined()
    // can still record afterward
    cache.record(["h_1"], {
      classifications: [fakeClassification("h_1")],
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(cache.lookup(["h_1"])).toBeDefined()
  })

  it("creates the parent directory if missing", () => {
    const nested = join(dir, "a", "b", "c", "cache.json")
    const cache = new FileBatchCache(nested)
    cache.record(["h_1"], {
      classifications: [fakeClassification("h_1")],
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(existsSync(nested)).toBe(true)
  })

  it("writes atomically (no .tmp file lingers)", () => {
    const cache = new FileBatchCache(file)
    cache.record(["h_1"], {
      classifications: [fakeClassification("h_1")],
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(existsSync(file)).toBe(true)
    expect(existsSync(file + ".tmp")).toBe(false)
    // file must be valid JSON
    expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow()
  })
})
