import { describe, it, expect } from "vitest"
import { runManifest } from "../../../src/commands/manifest.js"
import { DEFAULT_CONFIG } from "../../../src/config/load.js"
import type { Classifier } from "../../../src/classify/classifier.js"

const fakeClassifier: Classifier = {
  provider: "claude", model: "fake",
  estimateTokens: (s) => Math.ceil(s.length / 4),
  classify: async ({ hunks }) => ({
    classifications: hunks.map((h) => ({
      hunk_id: h.id, layer: "A", confidence: 0.9,
      intents: ["typo"], rationale: "fake",
    })),
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
}

const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-Hi
+Hello
`

describe("runManifest", () => {
  it("returns a manifest with one entry per hunk", async () => {
    const m = await runManifest({
      pr: {
        owner: "x", repo: "y", number: 1, title: "t",
        baseBranch: "main", baseSha: "b", headSha: "h",
        url: "u",
      },
      diff,
      config: DEFAULT_CONFIG,
      classifier: fakeClassifier,
    })
    expect(m.entries.length).toBeGreaterThan(0)
    expect(m.entries[0]!.layer).toBe("A")
  })
})
