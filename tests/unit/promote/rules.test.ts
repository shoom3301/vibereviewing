import { describe, it, expect } from "vitest"
import {
  multiIntentRule, lowConfidenceRule, crossReferenceRule, dependencyRule,
  exportedSymbolRule, generatedFileRule, domainFloorRule,
} from "../../../src/promote/rules.js"
import {
  makeClassification, makeHunk, makeFile, makeContext, seedResult,
} from "./_helpers.js"

describe("multiIntentRule", () => {
  it("escalates one layer when intents.length > 1", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ layer: "A", intents: ["typo", "rename_internal"] })])
    const r = seedResult(ctx); multiIntentRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("B")
    expect(r.get("h_1")!.escalations).toContain("multi_intent")
  })

  it("does not escalate when only one intent", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ layer: "A", intents: ["typo"] })])
    const r = seedResult(ctx); multiIntentRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("A")
  })

  it("escalates B to C", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ layer: "B", intents: ["ui_pure", "validation_localized"] })])
    const r = seedResult(ctx); multiIntentRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("C")
  })
})

describe("lowConfidenceRule", () => {
  it("escalates when confidence is below threshold", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ confidence: 0.6 })])
    const r = seedResult(ctx); lowConfidenceRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("B")
    expect(r.get("h_1")!.escalations).toContain("low_confidence")
  })

  it("does not escalate at threshold", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ confidence: 0.7 })])
    const r = seedResult(ctx); lowConfidenceRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("A")
  })
})

describe("crossReferenceRule", () => {
  it("escalates to B when a string literal also appears in a json file", () => {
    const ts = makeHunk("src/api.ts",
      `@@\n-const KEY = "FOO_FLAG"\n+const KEY = "BAR_FLAG"`, "h_ts")
    const json = makeHunk("flags.json", `@@\n   "FOO_FLAG": true,`, "h_json")
    const ctx = makeContext(
      [makeFile("src/api.ts", [ts]), makeFile("flags.json", [json])],
      [
        makeClassification({ hunk_id: "h_ts", layer: "A", intents: ["rename_internal"] }),
        makeClassification({ hunk_id: "h_json", layer: "A", intents: ["config_trivial"] }),
      ],
    )
    const r = seedResult(ctx); crossReferenceRule(ctx, r)
    expect(r.get("h_ts")!.layer).toBe("B")
    expect(r.get("h_ts")!.escalations).toContain("cross_reference")
  })

  it("does not escalate without a cross-reference", () => {
    const ts = makeHunk("src/api.ts",
      `@@\n-const KEY = "FOO_FLAG"\n+const KEY = "BAR_FLAG"`, "h_ts")
    const ctx = makeContext([makeFile("src/api.ts", [ts])],
      [makeClassification({ hunk_id: "h_ts", layer: "A", intents: ["rename_internal"] })])
    const r = seedResult(ctx); crossReferenceRule(ctx, r)
    expect(r.get("h_ts")!.layer).toBe("A")
  })
})
