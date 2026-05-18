import Anthropic from "@anthropic-ai/sdk"
import { countTokens } from "@anthropic-ai/tokenizer"
import { CLASSIFICATIONS_JSON_SCHEMA, classificationsSchema } from "./schema.js"
import type { Classifier, ClassifyRequest, ClassifyResponse, Usage } from "./classifier.js"
import type { Classification } from "../promote/types.js"

export type ClaudeClassifierOpts = { apiKey: string; model: string }

type RawResponse = {
  content?: Array<
    | { type: "tool_use"; name: string; input: unknown }
    | { type: "text"; text: string }
  >
  usage?: {
    input_tokens?: number; output_tokens?: number
    cache_creation_input_tokens?: number; cache_read_input_tokens?: number
  }
}

export class ClaudeClassifier implements Classifier {
  readonly provider = "claude" as const
  readonly model: string
  private client: Anthropic

  constructor(opts: ClaudeClassifierOpts) {
    this.model = opts.model
    this.client = new Anthropic({ apiKey: opts.apiKey })
  }

  estimateTokens(text: string): number {
    return countTokens(text)
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      temperature: 0,
      system: [
        {
          type: "text",
          text: req.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ] as unknown as string,  // SDK type accepts string[] of blocks at runtime
      tools: [CLASSIFICATIONS_JSON_SCHEMA as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "submit_classifications" },
      messages: [{
        role: "user",
        content: JSON.stringify({
          hunks: req.hunks.map((h) => ({
            id: h.id, file: h.file, language: h.context.fileLanguage,
            isGenerated: h.context.isGenerated, domainFloor: h.context.domainFloor,
            diff: h.body,
          })),
        }),
      }],
    })
    return this.parseResponseForTest(res as unknown as RawResponse)
  }

  parseResponseForTest(res: RawResponse): ClassifyResponse {
    const toolBlock = res.content?.find(
      (b): b is { type: "tool_use"; name: string; input: unknown } =>
        b.type === "tool_use" && b.name === "submit_classifications")
    if (!toolBlock) throw new Error("Claude response missing tool_use block")
    const parsed = classificationsSchema.parse(toolBlock.input) as { classifications: Classification[] }
    const usage: Usage = {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? 0,
    }
    return { classifications: parsed.classifications, usage }
  }
}
