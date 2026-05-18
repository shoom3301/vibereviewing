import { z } from "zod"
import { ALL_INTENTS } from "../types.js"

export const classificationsSchema = z.object({
  classifications: z.array(z.object({
    hunk_id: z.string(),
    layer: z.enum(["A", "B", "C"]),
    confidence: z.number().min(0).max(1),
    intents: z.array(z.enum(ALL_INTENTS as [string, ...string[]])).min(1),
    rationale: z.string().max(400),
  })),
})

export const CLASSIFICATIONS_JSON_SCHEMA = {
  name: "submit_classifications",
  description: "Submit layer classifications for every input hunk.",
  input_schema: {
    type: "object",
    required: ["classifications"],
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          required: ["hunk_id", "layer", "confidence", "intents", "rationale"],
          properties: {
            hunk_id: { type: "string" },
            layer: { enum: ["A", "B", "C"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            intents: {
              type: "array",
              minItems: 1,
              items: { enum: [...ALL_INTENTS] },
            },
            rationale: { type: "string", maxLength: 400 },
          },
        },
      },
    },
  },
} as const
