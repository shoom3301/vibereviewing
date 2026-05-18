import picomatch from "picomatch"
import type { FileChange } from "./types.js"
import type { Layer } from "../types.js"

export type ContextConfig = {
  floors: { B?: string[]; C?: string[] }
  generated: string[]
}

const LAYER_RANK: Record<Layer, number> = { A: 0, B: 1, C: 2 }

function maxLayer(a: Layer, b: Layer): Layer {
  return LAYER_RANK[a] >= LAYER_RANK[b] ? a : b
}

export function applyContext(files: FileChange[], config: ContextConfig): void {
  const matchB = config.floors.B && config.floors.B.length > 0
    ? picomatch(config.floors.B)
    : () => false
  const matchC = config.floors.C && config.floors.C.length > 0
    ? picomatch(config.floors.C)
    : () => false
  const matchGen = config.generated.length > 0
    ? picomatch(config.generated)
    : () => false

  for (const file of files) {
    let floor: Layer = "A"
    if (matchB(file.file)) floor = maxLayer(floor, "B")
    if (matchC(file.file)) floor = maxLayer(floor, "C")
    const isGenerated = matchGen(file.file)

    for (const hunk of file.hunks) {
      hunk.context.domainFloor = floor
      hunk.context.isGenerated = isGenerated
    }
  }
}
