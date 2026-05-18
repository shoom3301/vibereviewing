import type { Rule } from "./types.js"
import { escalateOne } from "./layers.js"

export const multiIntentRule: Rule = (ctx, current) => {
  for (const [id, c] of current) {
    const cl = ctx.classifications.get(id)!
    if (cl.intents.length > 1) {
      c.layer = escalateOne(c.layer)
      c.escalations.push("multi_intent")
    }
  }
}

export const lowConfidenceRule: Rule = (ctx, current) => {
  for (const [id, c] of current) {
    const cl = ctx.classifications.get(id)!
    if (cl.confidence < ctx.confidenceThreshold) {
      c.layer = escalateOne(c.layer)
      c.escalations.push("low_confidence")
    }
  }
}

// remaining rules stay as no-ops; filled in subsequent tasks
export const crossReferenceRule: Rule = () => {}
export const dependencyRule: Rule = () => {}
export const exportedSymbolRule: Rule = () => {}
export const generatedFileRule: Rule = () => {}
export const domainFloorRule: Rule = () => {}
