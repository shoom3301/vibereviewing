import OpenAI from "openai"
import { encoding_for_model, get_encoding } from "tiktoken"
import { CLASSIFICATIONS_JSON_SCHEMA, classificationsSchema } from "./schema.js"
import type { Classifier, ClassifyRequest, ClassifyResponse, Usage } from "./classifier.js"
import type { Classification } from "../promote/types.js"

export type OpenAIClassifierOpts = { apiKey: string; model: string }

function supportsTemperature(model: string): boolean {
  return !/^(o[134]|gpt-5)/.test(model)
}

const STRICT_UNSUPPORTED_KEYS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "format",
  "minItems", "maxItems", "uniqueItems",
  "minProperties", "maxProperties",
])

export function toOpenAIStrictSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(toOpenAIStrictSchema)
  if (input === null || typeof input !== "object") return input
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (STRICT_UNSUPPORTED_KEYS.has(k)) continue
    out[k] = toOpenAIStrictSchema(v)
  }
  if (out.type === "object" && out.properties && out.additionalProperties === undefined) {
    out.additionalProperties = false
  }
  return out
}

type RawCompletion = {
  choices: Array<{ message: { content: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class OpenAIClassifier implements Classifier {
  readonly provider = "openai" as const
  readonly model: string
  private client: OpenAI
  private encoder: { encode: (s: string) => Uint32Array; free?: () => void }

  constructor(opts: OpenAIClassifierOpts) {
    this.model = opts.model
    this.client = new OpenAI({ apiKey: opts.apiKey })
    try {
      this.encoder = encoding_for_model(opts.model as any)
    } catch {
      this.encoder = get_encoding("o200k_base")
    }
  }

  estimateTokens(text: string): number {
    return this.encoder.encode(text).length
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      ...(supportsTemperature(this.model) ? { temperature: 0 } : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "submit_classifications",
          schema: toOpenAIStrictSchema(CLASSIFICATIONS_JSON_SCHEMA.input_schema) as Record<string, unknown>,
          strict: true,
        },
      },
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: JSON.stringify({
          hunks: req.hunks.map((h) => ({
            id: h.id, file: h.file, language: h.context.fileLanguage,
            isGenerated: h.context.isGenerated, domainFloor: h.context.domainFloor,
            diff: h.body,
          })),
        }) },
      ],
    })
    return this.parseResponseForTest(res as unknown as RawCompletion)
  }

  parseResponseForTest(res: RawCompletion): ClassifyResponse {
    const content = res.choices[0]?.message.content
    if (!content) throw new Error("OpenAI completion has empty content")
    let parsed: unknown
    try { parsed = JSON.parse(content) }
    catch (e) { throw new Error(`OpenAI returned non-JSON: ${(e as Error).message}`) }
    const validated = classificationsSchema.parse(parsed) as { classifications: Classification[] }
    const usage: Usage = {
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    }
    return { classifications: validated.classifications, usage }
  }
}
