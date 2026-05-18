import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { OpenAIClassifier } from "../../../src/classify/openai.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const recorded = JSON.parse(readFileSync(
  join(__dirname, "../../fixtures/llm-responses/openai-simple.json"), "utf8"))

describe("OpenAIClassifier", () => {
  it("parses a structured-output completion into classifications", () => {
    const c = new OpenAIClassifier({ apiKey: "x", model: "gpt-5" })
    const parsed = c.parseResponseForTest(recorded)
    expect(parsed.classifications).toHaveLength(1)
    expect(parsed.classifications[0]!.hunk_id).toBe("h_test_1")
    expect(parsed.usage.inputTokens).toBe(1234)
  })

  it("throws on non-JSON content", () => {
    const c = new OpenAIClassifier({ apiKey: "x", model: "gpt-5" })
    expect(() => c.parseResponseForTest({
      choices: [{ message: { content: "I cannot do that." } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    } as any)).toThrow()
  })
})
