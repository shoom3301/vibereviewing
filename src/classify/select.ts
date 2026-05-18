import type { Provider } from "../types.js"
import type { Classifier } from "./classifier.js"
import type { Config } from "../config/schema.js"
import { ClaudeClassifier } from "./claude.js"
import { OpenAIClassifier } from "./openai.js"

export function detectFromEnv(env: NodeJS.ProcessEnv): Provider | null {
  if (env.ANTHROPIC_API_KEY) return "claude"
  if (env.OPENAI_API_KEY) return "openai"
  return null
}

export function requireKey(provider: Provider, env: NodeJS.ProcessEnv): string {
  if (provider === "claude") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for provider=claude")
    return env.ANTHROPIC_API_KEY
  }
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for provider=openai")
  return env.OPENAI_API_KEY
}

export function makeClassifier(opts: {
  provider: Provider; model?: string; config: Config; env: NodeJS.ProcessEnv
}): Classifier {
  const apiKey = requireKey(opts.provider, opts.env)
  if (opts.provider === "claude") {
    return new ClaudeClassifier({ apiKey, model: opts.model ?? opts.config.providers.claude.model })
  }
  return new OpenAIClassifier({ apiKey, model: opts.model ?? opts.config.providers.openai.model })
}
