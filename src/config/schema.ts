import { z } from "zod"

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  floors: z.object({
    B: z.array(z.string()).default([]),
    C: z.array(z.string()).default([]),
  }).default({ B: [], C: [] }),
  generated: z.array(z.string()).default([]),
  confidence_threshold: z.number().min(0).max(1).default(0.7),
  max_diff_tokens: z.number().int().positive().default(890000),
  providers: z.object({
    claude: z.object({ model: z.string() }).default({ model: "claude-opus-4-7" }),
    openai: z.object({ model: z.string() }).default({ model: "gpt-5" }),
  }).default({ claude: { model: "claude-opus-4-7" }, openai: { model: "gpt-5" } }),
})

export type Config = z.infer<typeof ConfigSchema>
