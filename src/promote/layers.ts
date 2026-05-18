import type { Layer } from "../types.js"

const RANK: Record<Layer, number> = { A: 0, B: 1, C: 2 }

export function maxLayer(a: Layer, b: Layer): Layer {
  return RANK[a] >= RANK[b] ? a : b
}

export function escalateOne(l: Layer): Layer {
  return l === "A" ? "B" : "C"
}
