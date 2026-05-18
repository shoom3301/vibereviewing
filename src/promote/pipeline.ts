import type { PromoteContext, PromotedClassification } from "./types.js"
import {
  multiIntentRule, lowConfidenceRule, crossReferenceRule, dependencyRule,
  exportedSymbolRule, generatedFileRule, domainFloorRule,
} from "./rules.js"

export function promote(ctx: PromoteContext): Map<string, PromotedClassification> {
  const result = new Map<string, PromotedClassification>()
  for (const [id, c] of ctx.classifications) {
    result.set(id, { ...c, originalLayer: c.layer, escalations: [] })
  }
  // Order from §5 stage 4. Domain floor runs last so nothing can outweigh it.
  multiIntentRule(ctx, result)
  lowConfidenceRule(ctx, result)
  crossReferenceRule(ctx, result)
  dependencyRule(ctx, result)
  exportedSymbolRule(ctx, result)
  generatedFileRule(ctx, result)
  domainFloorRule(ctx, result)
  return result
}
