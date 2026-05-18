import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { promote } from "../../../src/promote/pipeline.js"
import { makeClassification, makeHunk, makeFile, makeContext } from "./_helpers.js"

describe("promote", () => {
  it("applies all rules and returns PromotedClassification per hunk", () => {
    const h1 = makeHunk("src/settlement/x.ts", "@@", "h_1", { floor: "C" })
    const h2 = makeHunk("src/utils/y.ts", "@@", "h_2")
    const ctx = makeContext(
      [makeFile("src/settlement/x.ts", [h1]), makeFile("src/utils/y.ts", [h2])],
      [
        makeClassification({ hunk_id: "h_1", layer: "A", confidence: 0.95, intents: ["typo"] }),
        makeClassification({ hunk_id: "h_2", layer: "B", confidence: 0.6, intents: ["ui_pure"] }),
      ],
    )
    const result = promote(ctx)
    expect(result.get("h_1")!.layer).toBe("C")  // floor
    expect(result.get("h_2")!.layer).toBe("C")  // confidence escalation B → C
  })

  it("preserves originalLayer", () => {
    const h = makeHunk("src/settlement/x.ts", "@@", "h_1", { floor: "C" })
    const ctx = makeContext([makeFile("src/settlement/x.ts", [h])],
      [makeClassification({ hunk_id: "h_1", layer: "A" })])
    const result = promote(ctx)
    expect(result.get("h_1")!.originalLayer).toBe("A")
    expect(result.get("h_1")!.layer).toBe("C")
  })

  it("never demotes any hunk's layer (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("A", "B", "C") as fc.Arbitrary<"A"|"B"|"C">,
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("A", "B", "C") as fc.Arbitrary<"A"|"B"|"C">,
        (layer, conf, floor) => {
          const h = makeHunk("src/x.ts", "@@", "h_p", { floor })
          const ctx = makeContext([makeFile("src/x.ts", [h])],
            [makeClassification({ hunk_id: "h_p", layer, confidence: conf })])
          const rank = { A: 0, B: 1, C: 2 } as const
          const result = promote(ctx)
          return rank[result.get("h_p")!.layer] >= rank[layer]
        },
      ),
    )
  })
})
