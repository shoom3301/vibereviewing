import type { Layer, Intent } from "../types.js"
import type { Hunk, FileChange } from "../hunkify/types.js"

export type Classification = {
  hunk_id: string
  layer: Layer
  confidence: number
  intents: Intent[]
  rationale: string
}

export type EscalationReason =
  | "multi_intent" | "low_confidence" | "cross_reference"
  | "dependency" | "exported_symbol"
  | "generated_missing_source" | "domain_floor"

export type PromotedClassification = Classification & {
  originalLayer: Layer
  escalations: EscalationReason[]
}

export type PromoteContext = {
  files: FileChange[]
  hunks: Hunk[]
  classifications: Map<string, Classification>
  confidenceThreshold: number
}

export type Rule = (
  ctx: PromoteContext,
  current: Map<string, PromotedClassification>,
) => void
