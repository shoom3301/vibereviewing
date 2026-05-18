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

describe("dependencyRule", () => {
  it("escalates to C on a major version bump", () => {
    const h = makeHunk("package.json",
      `@@\n   "dependencies": {\n-    "react": "^17.0.2",\n+    "react": "^18.0.0",\n   },`,
      "h_pkg")
    const ctx = makeContext([makeFile("package.json", [h])],
      [makeClassification({ hunk_id: "h_pkg", layer: "B", intents: ["dep_major"] })])
    const r = seedResult(ctx); dependencyRule(ctx, r)
    expect(r.get("h_pkg")!.layer).toBe("C")
    expect(r.get("h_pkg")!.escalations).toContain("dependency")
  })

  it("escalates to C on any runtime dep edit", () => {
    const h = makeHunk("package.json",
      `@@\n   "dependencies": {\n-    "lodash": "4.17.20",\n+    "lodash": "4.17.21",\n   },`,
      "h_pkg")
    const ctx = makeContext([makeFile("package.json", [h])],
      [makeClassification({ hunk_id: "h_pkg", layer: "A", intents: ["dep_runtime"] })])
    const r = seedResult(ctx); dependencyRule(ctx, r)
    expect(r.get("h_pkg")!.layer).toBe("C")
  })

  it("does not escalate a devDependencies patch bump", () => {
    const h = makeHunk("package.json",
      `@@\n   "devDependencies": {\n-    "vitest": "2.0.0",\n+    "vitest": "2.0.1",\n   },`,
      "h_pkg")
    const ctx = makeContext([makeFile("package.json", [h])],
      [makeClassification({ hunk_id: "h_pkg", layer: "A", intents: ["dep_dev_patch"] })])
    const r = seedResult(ctx); dependencyRule(ctx, r)
    expect(r.get("h_pkg")!.layer).toBe("A")
  })
})

describe("exportedSymbolRule", () => {
  it("escalates definition and caller hunks together to B on exported rename", () => {
    const def = makeHunk("src/api.ts",
      `@@\n-export function getOrder(id: string) {\n+export function fetchOrder(id: string) {`,
      "h_def")
    const caller = makeHunk("src/page.ts",
      `@@\n-  const o = await getOrder(id)\n+  const o = await fetchOrder(id)`,
      "h_caller")
    const ctx = makeContext(
      [makeFile("src/api.ts", [def]), makeFile("src/page.ts", [caller])],
      [
        makeClassification({ hunk_id: "h_def", layer: "A", intents: ["rename_internal"] }),
        makeClassification({ hunk_id: "h_caller", layer: "A", intents: ["rename_internal"] }),
      ],
    )
    const r = seedResult(ctx); exportedSymbolRule(ctx, r)
    expect(r.get("h_def")!.layer).toBe("B")
    expect(r.get("h_caller")!.layer).toBe("B")
    expect(r.get("h_def")!.escalations).toContain("exported_symbol")
  })

  it("does not escalate when the rename is not exported", () => {
    const def = makeHunk("src/api.ts",
      `@@\n-function helper() {\n+function utility() {`, "h_def")
    const ctx = makeContext([makeFile("src/api.ts", [def])],
      [makeClassification({ hunk_id: "h_def", layer: "A", intents: ["rename_internal"] })])
    const r = seedResult(ctx); exportedSymbolRule(ctx, r)
    expect(r.get("h_def")!.layer).toBe("A")
  })
})
