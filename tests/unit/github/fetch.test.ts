import { describe, it, expect, vi } from "vitest"
import { parsePrUrl, fetchPRFromCommands } from "../../../src/github/fetch.js"

describe("parsePrUrl", () => {
  it("parses a full URL", () => {
    expect(parsePrUrl("https://github.com/cowprotocol/cowswap/pull/1234"))
      .toEqual({ owner: "cowprotocol", repo: "cowswap", number: 1234 })
  })

  it("parses a bare number against a default repo", () => {
    expect(parsePrUrl("1234", { owner: "x", repo: "y" }))
      .toEqual({ owner: "x", repo: "y", number: 1234 })
  })

  it("throws on a malformed input", () => {
    expect(() => parsePrUrl("nonsense")).toThrow()
  })
})

describe("fetchPRFromCommands", () => {
  it("uses gh to read metadata and git to read diff", async () => {
    const ghJson = JSON.stringify({
      number: 1234,
      title: "Test PR",
      html_url: "https://github.com/cowprotocol/cowswap/pull/1234",
      base: { ref: "main", sha: "abc123" },
      head: { ref: "feature", sha: "def456" },
    })
    const runGh = vi.fn().mockResolvedValue(ghJson)
    const runGitDiff = vi.fn().mockResolvedValue("diff --git a/x b/x\n")
    const pr = await fetchPRFromCommands({
      ref: { owner: "cowprotocol", repo: "cowswap", number: 1234 },
      runGh, runGitDiff,
    })
    expect(pr.pr.number).toBe(1234)
    expect(pr.pr.title).toBe("Test PR")
    expect(pr.pr.headSha).toBe("def456")
    expect(pr.pr.baseSha).toBe("abc123")
    expect(pr.diff).toContain("diff --git")
    expect(runGh).toHaveBeenCalled()
    expect(runGitDiff).toHaveBeenCalledWith("abc123", "def456")
  })

  it("emits a progress line before fetching", async () => {
    const ghJson = JSON.stringify({
      number: 7,
      title: "T",
      html_url: "https://github.com/o/r/pull/7",
      base: { ref: "main", sha: "a" },
      head: { ref: "f", sha: "b" },
    })
    const runGh = vi.fn().mockResolvedValue(ghJson)
    const runGitDiff = vi.fn().mockResolvedValue("")
    const messages: string[] = []
    await fetchPRFromCommands({
      ref: { owner: "o", repo: "r", number: 7 },
      runGh, runGitDiff,
      onProgress: (m) => messages.push(m),
    })
    expect(messages).toEqual(["fetching PR #7 from o/r"])
  })
})
