import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { ClaudeClassifier } from "../../../src/classify/claude.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const recorded = JSON.parse(readFileSync(
  join(__dirname, "../../fixtures/llm-responses/claude-simple.json"), "utf8"))

describe("ClaudeClassifier", () => {
  it("parses a tool_use response into classifications + usage", () => {
    const c = new ClaudeClassifier({ apiKey: "x", model: "claude-opus-4-7" })
    const parsed = c.parseResponseForTest(recorded)
    expect(parsed.classifications).toHaveLength(1)
    expect(parsed.classifications[0]!.hunk_id).toBe("h_test_1")
    expect(parsed.usage.inputTokens).toBe(1234)
    expect(parsed.usage.cacheWriteTokens).toBe(800)
  })

  it("estimates tokens with a non-zero result", () => {
    const c = new ClaudeClassifier({ apiKey: "x", model: "claude-opus-4-7" })
    expect(c.estimateTokens("hello world")).toBeGreaterThan(0)
  })

  it("throws when the response has no tool_use block", () => {
    const c = new ClaudeClassifier({ apiKey: "x", model: "claude-opus-4-7" })
    expect(() => c.parseResponseForTest({
      content: [{ type: "text", text: "I refuse." }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })).toThrow(/tool_use/)
  })
})
