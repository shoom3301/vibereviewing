import { z } from "zod"
import { ALL_INTENTS } from "../types.js"

// Truncate rather than reject overlong rationales: the JSON schema we send
// to the model declares maxLength: 400, but some models (notably the smaller
// ones) occasionally exceed it. Failing the whole batch over a long string
// is worse than silently clipping it.
const truncatedRationale = z.string().transform(
  (s) => s.length <= 400 ? s : s.slice(0, 397) + "...",
)

export const classificationsSchema = z.object({
  classifications: z.array(z.object({
    hunk_id: z.string(),
    layer: z.enum(["A", "B", "C"]),
    confidence: z.number().min(0).max(1),
    intents: z.array(z.enum(ALL_INTENTS as [string, ...string[]])).min(1),
    rationale: truncatedRationale,
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
