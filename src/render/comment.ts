export type CommentArgs = {
  companion: { owner: string; repo: string; number: number }
  layerCCommit: string
  layerCHunks: number
  layerCFiles: number
}

export const COMMENT_MARKER = "<!-- vibereview:companion -->"

export function renderOriginalPrComment(a: CommentArgs): string {
  const sha7 = a.layerCCommit.slice(0, 7)
  const commitUrl = `https://github.com/${a.companion.owner}/${a.companion.repo}/commit/${a.layerCCommit}`
  return `🪄 **vibereview**: layered-review companion opened at #${a.companion.number}.

Focus your review on the Layer C commit: [\`${sha7}\`](${commitUrl}) (${a.layerCHunks} hunks, ${a.layerCFiles} files).
The underlying diff is byte-identical to this PR.

${COMMENT_MARKER}
`
}
