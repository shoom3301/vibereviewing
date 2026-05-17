import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseDiff } from "../../../src/hunkify/parse.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const fx = (name: string) =>
  readFileSync(join(__dirname, "../../fixtures/diffs", name), "utf8")

describe("parseDiff", () => {
  it("parses a simple two-hunk file", () => {
    const files = parseDiff(fx("simple.diff"))
    expect(files).toHaveLength(1)
    expect(files[0]!.file).toBe("src/a.ts")
    expect(files[0]!.hunks).toHaveLength(2)
    expect(files[0]!.hunks[0]!.oldStart).toBe(1)
    expect(files[0]!.hunks[0]!.oldLines).toBe(3)
    expect(files[0]!.hunks[1]!.newStart).toBe(10)
    expect(files[0]!.hunks[1]!.newLines).toBe(3)
    expect(files[0]!.hunks[0]!.id).toMatch(/^h_/)
  })

  it("parses a rename with body changes", () => {
    const files = parseDiff(fx("rename-with-body.diff"))
    expect(files).toHaveLength(1)
    expect(files[0]!.file).toBe("src/new.ts")
    expect(files[0]!.oldPath).toBe("src/old.ts")
    expect(files[0]!.isRename).toBe(true)
    expect(files[0]!.hunks).toHaveLength(1)
  })

  it("represents a binary file as one atomic hunk", () => {
    const files = parseDiff(fx("binary.diff"))
    expect(files).toHaveLength(1)
    expect(files[0]!.isBinary).toBe(true)
    expect(files[0]!.hunks).toHaveLength(1)
    expect(files[0]!.hunks[0]!.isBinary).toBe(true)
  })

  it("flags file deletions", () => {
    const files = parseDiff(fx("delete.diff"))
    expect(files[0]!.isDelete).toBe(true)
  })

  it("represents a submodule pointer change as one atomic hunk", () => {
    const files = parseDiff(fx("submodule.diff"))
    expect(files[0]!.isSubmodule).toBe(true)
    expect(files[0]!.hunks).toHaveLength(1)
    expect(files[0]!.hunks[0]!.isSubmodule).toBe(true)
  })

  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([])
  })
})
