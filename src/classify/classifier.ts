import type { Hunk } from "../hunkify/types.js"
import type { Classification } from "../promote/types.js"
import type { Provider } from "../types.js"

export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type ClassifyRequest = {
  systemPrompt: string
  hunks: Hunk[]
}

export type ClassifyResponse = {
  classifications: Classification[]
  usage: Usage
}

export interface Classifier {
  readonly provider: Provider
  readonly model: string
  classify(req: ClassifyRequest): Promise<ClassifyResponse>
  estimateTokens(text: string): number
}
