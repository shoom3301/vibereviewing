import { createHash } from "node:crypto"

export type HunkIdInput = {
  file: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  body: string
}

export function computeHunkId(input: HunkIdInput): string {
  const canonical = [
    input.file,
    input.oldStart,
    input.oldLines,
    input.newStart,
    input.newLines,
    input.body,
  ].join(" ")
  const hash = createHash("sha256").update(canonical).digest("hex")
  return `h_${hash.slice(0, 12)}`
}
