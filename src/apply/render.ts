import type { FileChange, Hunk } from "../hunkify/types.js"

export function renderLayerPatch(files: FileChange[], selectedHunkIds: Set<string>): string {
  const out: string[] = []
  for (const f of files) {
    const hunks = f.hunks.filter((h) => selectedHunkIds.has(h.id))
    if (hunks.length === 0) continue
    out.push(...renderFile(f, hunks))
  }
  return out.length === 0 ? "" : out.join("\n") + "\n"
}

function renderFile(f: FileChange, hunks: Hunk[]): string[] {
  const isNewFile = f.oldPath === null && !f.isDelete
  const oldPath = f.oldPath ?? f.file
  const newPath = f.file
  const lines: string[] = [`diff --git a/${oldPath} b/${newPath}`]
  if (isNewFile) lines.push("new file mode 100644")
  if (f.isRename) {
    lines.push("similarity index 90%")
    lines.push(`rename from ${oldPath}`)
    lines.push(`rename to ${newPath}`)
  }
  if (f.isDelete) lines.push("deleted file mode 100644")
  if (!f.isBinary && !f.isSubmodule) {
    lines.push(isNewFile ? "--- /dev/null" : `--- a/${oldPath}`)
    lines.push(`+++ b/${newPath}`)
  }
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart)
  for (const h of sorted) {
    if (h.isBinary) {
      lines.push(`Binary files a/${oldPath} and b/${newPath} differ`)
      continue
    }
    if (h.isSubmodule) {
      lines.push(h.body)
      continue
    }
    lines.push(h.body)
  }
  return lines
}
