import { describe, it, expect } from "vitest"
import { CLASSIFICATIONS_JSON_SCHEMA, classificationsSchema } from "../../../src/classify/schema.js"
import { ALL_INTENTS } from "../../../src/types.js"

describe("classifications schema", () => {
  it("validates a well-formed response", () => {
    const ok = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["typo"], rationale: "fixes typo",
      }],
    }
    expect(() => classificationsSchema.parse(ok)).not.toThrow()
  })

  it("rejects an unknown intent string", () => {
    const bad = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["not_a_real_intent"], rationale: "",
      }],
    }
    expect(() => classificationsSchema.parse(bad)).toThrow()
  })

  it("rejects a layer outside A/B/C", () => {
    const bad = {
      classifications: [{
        hunk_id: "h_1", layer: "D", confidence: 0.9,
        intents: ["typo"], rationale: "",
      }],
    }
    expect(() => classificationsSchema.parse(bad)).toThrow()
  })

  it("truncates rationale > 400 chars instead of rejecting", () => {
    // Some models (notably gpt-5-mini, haiku) occasionally exceed the
    // declared maxLength in the JSON schema. Failing the whole batch over
    // a long rationale is worse than just clipping the string.
    const input = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["typo"], rationale: "x".repeat(500),
      }],
    }
    const parsed = classificationsSchema.parse(input)
    expect(parsed.classifications[0]!.rationale).toHaveLength(400)
    expect(parsed.classifications[0]!.rationale.endsWith("...")).toBe(true)
  })

  it("leaves a short rationale untouched", () => {
    const input = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["typo"], rationale: "short and sweet",
      }],
    }
    expect(classificationsSchema.parse(input).classifications[0]!.rationale)
      .toBe("short and sweet")
  })

  it("the exported JSON schema enumerates every intent", () => {
    const schemaIntents = CLASSIFICATIONS_JSON_SCHEMA.input_schema.properties
      .classifications.items.properties.intents.items.enum
    expect(new Set(schemaIntents)).toEqual(new Set(ALL_INTENTS))
  })
})
