import { describe, it, expect } from "vitest"
import { formatTrailers, type TrailerInput } from "../../../src/trailer/format.js"
import { parseTrailers } from "../../../src/trailer/parse.js"

const sample: TrailerInput = {
  layer: "A",
  sourcePR: "cowprotocol/cowswap#1234",
  sourceHead: "def456abc789",
  hunkIds: ["h_8f4e", "h_2c1a", "h_9d77"],
  toolVersion: "0.1.0",
  provider: "claude",
  model: "claude-opus-4-7",
}

describe("trailers", () => {
  it("formats canonical trailers", () => {
    const out = formatTrailers(sample)
    expect(out).toMatch(/^Vibereview-Layer: A$/m)
    expect(out).toMatch(/^Vibereview-Source-PR: cowprotocol\/cowswap#1234$/m)
    expect(out).toMatch(/^Vibereview-Hunks: h_8f4e,h_2c1a,h_9d77$/m)
  })

  it("round-trips through parseTrailers", () => {
    const message = `Header\n\nBody.\n\n${formatTrailers(sample)}`
    const parsed = parseTrailers(message)
    expect(parsed).toEqual(sample)
  })

  it("returns null when trailers are absent", () => {
    expect(parseTrailers("just a message body")).toBeNull()
  })

  it("preserves hunk-id order", () => {
    const out = formatTrailers({ ...sample, hunkIds: ["h_z", "h_a", "h_m"] })
    const parsed = parseTrailers(out)
    expect(parsed!.hunkIds).toEqual(["h_z", "h_a", "h_m"])
  })
})
