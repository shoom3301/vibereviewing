import type { Layer, Provider, Intent } from "../types.js"
import type { EscalationReason } from "../promote/types.js"

export type PrBodyEntry = {
  file: string
  line: number
  intent: Intent
  rationale: string
}

export type PrBodyLayer = {
  layer: Layer
  commitSha: string
  hunks: number
  files: number
  entries: PrBodyEntry[]
}

export type PrBodyEscalation = {
  hunkId: string
  file: string
  line: number
  from: Layer
  to: Layer
  reason: EscalationReason
}

export type PrBodyArgs = {
  sourcePR: { owner: string; repo: string; number: number; headSha: string }
  companion: { owner: string; repo: string; number: number }
  layers: PrBodyLayer[]
  escalations: PrBodyEscalation[]
  provenance: {
    generatedAt: Date
    toolVersion: string
    provider: Provider
    model: string
  }
}

const DEPTH: Record<Layer, string> = {
  A: "Skim or trust CodeRabbit",
  B: "Skim intent + tests",
  C: "Full review",
}

const LABEL: Record<Layer, string> = {
  A: "**A** — AI-auto-reviewable",
  B: "**B** — Light human review",
  C: "**C** — Human review required",
}

export function renderPrBody(a: PrBodyArgs): string {
  const src = a.sourcePR
  const commitUrl = (sha: string) =>
    `https://github.com/${src.owner}/${src.repo}/commit/${sha}`

  const tableRows = a.layers.map((l) =>
    `| ${LABEL[l.layer]} | [\`${l.commitSha.slice(0, 7)}\`](${commitUrl(l.commitSha)}) | ${l.hunks} | ${l.files} | ${DEPTH[l.layer]} |`
  ).join("\n")

  const layerB = a.layers.find((l) => l.layer === "B")
  const layerC = a.layers.find((l) => l.layer === "C")
  const focusLine = layerB && layerC
    ? `To review only the human-required changes: \`git diff ${layerB.commitSha.slice(0, 7)}..${layerC.commitSha.slice(0, 7)}\``
    : layerC
      ? `To review only the human-required changes: \`git diff ${src.headSha.slice(0, 7)}..${layerC.commitSha.slice(0, 7)}\``
      : ""

  const manifestSection = a.layers.map((l) => {
    const heading = `${l.hunks} hunks in Layer ${l.layer}` +
      (l.layer === "C" ? " — focus your review here" : "")
    const items = l.entries.map((e) =>
      `- \`${e.file}:${e.line}\` — ${e.intent} — _"${e.rationale}"_`
    ).join("\n")
    const tag = l.layer === "C" ? "<details open>" : "<details>"
    return `${tag}\n<summary>${heading}</summary>\n\n${items}\n</details>`
  }).join("\n\n")

  const escalationSection = a.escalations.length === 0 ? "" :
    `\n\n## Escalations\n\n${a.escalations.length} hunks were escalated beyond their classifier verdict:\n\n` +
    a.escalations.map((e) =>
      `- \`${e.file}:${e.line}\` — ${e.from} → ${e.to} — _${humanize(e.reason)}._`
    ).join("\n")

  const date = a.provenance.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"

  return `> **This is a layered-review companion for #${src.number}.** It is not meant to be merged.
> The underlying diff is byte-identical to #${src.number} — review here for clarity, merge there.

## Layers

| Layer | Commit | Hunks | Files | Review depth |
|-------|--------|-------|-------|--------------|
${tableRows}

${focusLine}

## Manifest

${manifestSection}${escalationSection}

## Provenance

- Source: \`${src.owner}/${src.repo}#${src.number}\` @ \`${src.headSha.slice(0, 7)}\`
- Generated: ${date}
- Tool: \`vibereview@${a.provenance.toolVersion}\`
- Provider: \`${a.provenance.provider}\` (\`${a.provenance.model}\`)
- Manifest: [\`.vibereview/pr-${src.number}.json\`](https://github.com/${a.companion.owner}/${a.companion.repo}/blob/HEAD/.vibereview/pr-${src.number}.json)
`
}

function humanize(reason: EscalationReason): string {
  switch (reason) {
    case "multi_intent": return "Multiple intents detected in a single hunk"
    case "low_confidence": return "Classifier confidence below threshold"
    case "cross_reference": return "Modified a string also present in a config file"
    case "dependency": return "Runtime dependency change or major bump"
    case "exported_symbol": return "Renamed an exported symbol — callers also escalated"
    case "generated_missing_source": return "Generated file with no source-of-generation in PR"
    case "domain_floor": return "Path matches a domain-floor glob in .vibereview.yml"
  }
}
