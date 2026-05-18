import type { Layer, Provider } from "../types.js"

export type TrailerInput = {
  layer: Layer
  sourcePR: string         // "owner/repo#123"
  sourceHead: string       // sha
  hunkIds: string[]
  toolVersion: string
  provider: Provider
  model: string
}

export function formatTrailers(t: TrailerInput): string {
  return [
    `Vibereview-Layer: ${t.layer}`,
    `Vibereview-Source-PR: ${t.sourcePR}`,
    `Vibereview-Source-Head: ${t.sourceHead}`,
    `Vibereview-Hunks: ${t.hunkIds.join(",")}`,
    `Vibereview-Tool-Version: ${t.toolVersion}`,
    `Vibereview-Provider: ${t.provider}`,
    `Vibereview-Model: ${t.model}`,
  ].join("\n")
}
