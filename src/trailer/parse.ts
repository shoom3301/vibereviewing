import type { TrailerInput } from "./format.js"
import type { Layer, Provider } from "../types.js"

const RE_LAYER    = /^Vibereview-Layer:\s*([ABC])\s*$/m
const RE_SRC_PR   = /^Vibereview-Source-PR:\s*(.+?)\s*$/m
const RE_SRC_HEAD = /^Vibereview-Source-Head:\s*([0-9a-f]+)\s*$/m
const RE_HUNKS    = /^Vibereview-Hunks:\s*(.+?)\s*$/m
const RE_VER      = /^Vibereview-Tool-Version:\s*(.+?)\s*$/m
const RE_PROV     = /^Vibereview-Provider:\s*(claude|openai)\s*$/m
const RE_MODEL    = /^Vibereview-Model:\s*(.+?)\s*$/m

export function parseTrailers(message: string): TrailerInput | null {
  const layer = message.match(RE_LAYER)?.[1] as Layer | undefined
  if (!layer) return null
  const srcPr = message.match(RE_SRC_PR)?.[1]
  const head = message.match(RE_SRC_HEAD)?.[1]
  const hunks = message.match(RE_HUNKS)?.[1]
  const ver = message.match(RE_VER)?.[1]
  const prov = message.match(RE_PROV)?.[1] as Provider | undefined
  const model = message.match(RE_MODEL)?.[1]
  if (!srcPr || !head || !hunks || !ver || !prov || !model) return null
  return {
    layer, sourcePR: srcPr, sourceHead: head,
    hunkIds: hunks.split(",").filter((s) => s.length > 0),
    toolVersion: ver, provider: prov, model,
  }
}
