import { describe, it, expect } from "vitest"
import { renderOriginalPrComment } from "../../../src/render/comment.js"

describe("renderOriginalPrComment", () => {
  const c = renderOriginalPrComment({
    companion: { owner: "cowprotocol", repo: "cowswap", number: 5678 },
    layerCCommit: "f7a8b9c",
    layerCHunks: 14,
    layerCFiles: 6,
  })

  it("starts with the vibereview marker for re-run detection", () => {
    expect(c).toMatch(/^🪄 \*\*vibereview\*\*:/m)
  })

  it("contains the hidden HTML marker", () => {
    expect(c).toContain("<!-- vibereview:companion -->")
  })

  it("links to the companion PR", () => {
    expect(c).toContain("#5678")
  })

  it("highlights the Layer C commit", () => {
    expect(c).toContain("f7a8b9c")
    expect(c).toMatch(/14 hunks, 6 files/)
  })
})
