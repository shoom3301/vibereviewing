import { describe, it, expect, vi } from "vitest"
import {
  createCompanionPRFromCommands, postOrUpdateCommentFromCommands,
} from "../../../src/github/pr.js"
import { COMMENT_MARKER } from "../../../src/render/comment.js"

describe("createCompanionPRFromCommands", () => {
  it("calls gh pr create with the right args and returns the URL", async () => {
    const runGh = vi.fn().mockResolvedValue("https://github.com/x/y/pull/5678\n")
    const url = await createCompanionPRFromCommands({
      runGh,
      sourcePR: { owner: "x", repo: "y", number: 1234 },
      branch: "vibereview/pr-1234-abc",
      base: "main",
      title: "[vibereview] PR #1234 — layered review (do not merge)",
      body: "body",
    })
    expect(url).toBe("https://github.com/x/y/pull/5678")
    expect(runGh).toHaveBeenCalledWith(expect.arrayContaining([
      "pr", "create", "--repo", "x/y",
      "--base", "main", "--head", "vibereview/pr-1234-abc",
      "--title", "[vibereview] PR #1234 — layered review (do not merge)",
      "--draft",
    ]))
  })
})

describe("postOrUpdateCommentFromCommands", () => {
  it("posts a new comment if none has the marker", async () => {
    const runGhJson = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 1, body: "unrelated" },
      { id: 2, body: "also unrelated" },
    ]))
    const runGh = vi.fn().mockResolvedValue("ok")
    await postOrUpdateCommentFromCommands({
      runGhJson, runGh,
      sourcePR: { owner: "x", repo: "y", number: 1234 },
      body: `hello ${COMMENT_MARKER}`,
    })
    const call = runGh.mock.calls[0]![0] as string[]
    expect(call).toContain("/repos/x/y/issues/1234/comments")
    expect(call).toContain("-X")
    expect(call.includes("POST")).toBe(true)
  })

  it("updates an existing comment when one carries the marker", async () => {
    const runGhJson = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 99, body: `prior ${COMMENT_MARKER}` },
    ]))
    const runGh = vi.fn().mockResolvedValue("ok")
    await postOrUpdateCommentFromCommands({
      runGhJson, runGh,
      sourcePR: { owner: "x", repo: "y", number: 1234 },
      body: `updated ${COMMENT_MARKER}`,
    })
    const call = runGh.mock.calls[0]![0] as string[]
    expect(call).toContain("/repos/x/y/issues/comments/99")
    expect(call.includes("PATCH")).toBe(true)
  })
})
