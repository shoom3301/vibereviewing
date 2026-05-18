import { describe, it, expect } from "vitest"
import { applyContext } from "../../../src/hunkify/context.js"
import type { FileChange } from "../../../src/hunkify/types.js"

function makeFile(path: string): FileChange {
  return {
    file: path, oldPath: null, language: "ts",
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false,
    hunks: [{
      id: "h_x", file: path, oldPath: null,
      oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body: "@@",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false, isModeChange: false,
      context: { fileLanguage: "ts", isGenerated: false, domainFloor: "A" },
    }],
  }
}

describe("applyContext", () => {
  const config = {
    floors: {
      C: ["**/settlement/**", "**/*.sol"],
      B: ["tsconfig*.json"],
    },
    generated: ["**/*.generated.ts"],
  }

  it("assigns domain floor C for matched paths", () => {
    const f = makeFile("src/settlement/engine.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.domainFloor).toBe("C")
  })

  it("assigns domain floor B for tsconfig", () => {
    const f = makeFile("tsconfig.base.json")
    applyContext([f], config)
    expect(f.hunks[0]!.context.domainFloor).toBe("B")
  })

  it("leaves domainFloor at A when no glob matches", () => {
    const f = makeFile("src/utils/format.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.domainFloor).toBe("A")
  })

  it("uses the highest floor when both B and C globs match", () => {
    const f = makeFile("contracts/Token.sol")
    applyContext([f], { floors: { B: ["**/*.sol"], C: ["**/*.sol"] }, generated: [] })
    expect(f.hunks[0]!.context.domainFloor).toBe("C")
  })

  it("marks generated files", () => {
    const f = makeFile("src/api.generated.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.isGenerated).toBe(true)
  })

  it("does not mark non-generated files", () => {
    const f = makeFile("src/api.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.isGenerated).toBe(false)
  })
})
