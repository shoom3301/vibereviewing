import type { Rule } from "./types.js"
import { escalateOne, maxLayer } from "./layers.js"

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

const CROSS_REF_EXTS = /\.(json|ya?ml|sql|env[a-zA-Z0-9._-]*)$|^\.env/

export const crossReferenceRule: Rule = (ctx, current) => {
  const configStrings = new Set<string>()
  for (const file of ctx.files) {
    if (!CROSS_REF_EXTS.test(file.file)) continue
    for (const h of file.hunks) {
      for (const lit of extractConfigStrings(h.body)) configStrings.add(lit)
    }
  }
  if (configStrings.size === 0) return

  for (const h of ctx.hunks) {
    if (CROSS_REF_EXTS.test(h.file)) continue
    const literals = extractStringLiterals(h.body)
    if (literals.some((l) => configStrings.has(l))) {
      const c = current.get(h.id)!
      if (c.layer === "A") {
        c.layer = "B"
        c.escalations.push("cross_reference")
      }
    }
  }
}

function extractStringLiterals(body: string): string[] {
  const out: string[] = []
  for (const line of body.split("\n")) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue
    const content = line.slice(1)
    for (const m of content.matchAll(/["']([A-Za-z0-9_.\-/:]{2,})["']/g)) out.push(m[1]!)
  }
  return out
}

function extractConfigStrings(body: string): string[] {
  const out: string[] = []
  for (const line of body.split("\n")) {
    for (const m of line.matchAll(/["']([A-Za-z0-9_.\-/:]{2,})["']/g)) out.push(m[1]!)
  }
  return out
}
export const dependencyRule: Rule = (ctx, current) => {
  for (const h of ctx.hunks) {
    if (!h.file.endsWith("package.json")) continue
    if (!touchesRuntimeSection(h.body) && !looksLikeMajorBump(h.body)) continue
    const c = current.get(h.id)!
    const before = c.layer
    c.layer = maxLayer(c.layer, "C")
    if (c.layer !== before) c.escalations.push("dependency")
  }
}

function touchesRuntimeSection(body: string): boolean {
  const runtimeSections = ["dependencies", "peerDependencies", "optionalDependencies"]
  const startRe = new RegExp(`"(${runtimeSections.join("|")})"\\s*:`)
  const otherSectionRe = /^"[A-Za-z]\w*[Dd]ependencies"\s*:/
  let inSection = false
  for (const raw of body.split("\n")) {
    const code = raw.replace(/^[+\- ]/, "").trim()
    if (startRe.test(code)) { inSection = true; continue }
    if (otherSectionRe.test(code)) { inSection = false; continue }
    if (inSection && (raw.startsWith("+") || raw.startsWith("-"))) return true
  }
  return false
}

function looksLikeMajorBump(body: string): boolean {
  const seen: Record<string, { from?: string; to?: string }> = {}
  for (const line of body.split("\n")) {
    const m = line.match(/^([+\-])\s+"([^"]+)"\s*:\s*"([\^~]?)(\d+)\.(\d+)\.(\d+)/)
    if (!m) continue
    const [, sign, pkg, , major] = m
    seen[pkg!] ??= {}
    if (sign === "-") seen[pkg!]!.from = major
    else seen[pkg!]!.to = major
  }
  return Object.values(seen).some((v) =>
    v.from !== undefined && v.to !== undefined && v.from !== v.to)
}

export const exportedSymbolRule: Rule = () => {}
export const generatedFileRule: Rule = () => {}
export const domainFloorRule: Rule = () => {}
