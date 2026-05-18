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

  it("rejects rationale > 400 chars", () => {
    const bad = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["typo"], rationale: "x".repeat(401),
      }],
    }
    expect(() => classificationsSchema.parse(bad)).toThrow()
  })

  it("the exported JSON schema enumerates every intent", () => {
    const schemaIntents = CLASSIFICATIONS_JSON_SCHEMA.input_schema.properties
      .classifications.items.properties.intents.items.enum
    expect(new Set(schemaIntents)).toEqual(new Set(ALL_INTENTS))
  })
})
