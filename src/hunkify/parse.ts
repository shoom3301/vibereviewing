import parseDiffLib from "parse-diff"
import { computeHunkId } from "./id.js"
import type { FileChange, Hunk } from "./types.js"

const LANG_BY_EXT: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
  json: "json", yaml: "yaml", yml: "yaml",
  md: "md", sql: "sql", sol: "sol",
  py: "py", go: "go", rs: "rs",
  css: "css", scss: "scss", html: "html",
}

function detectLanguage(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? ""
  return LANG_BY_EXT[ext] ?? "text"
}

/**
 * Build a set of file paths that appear in a "Binary files a/X and b/Y differ" line.
 * The parse-diff library does not set a binary flag, so we pre-scan the raw text.
 */
function extractBinaryPaths(diffText: string): Set<string> {
  const binaryPaths = new Set<string>()
  const re = /^Binary files (?:a\/)?(.+?) and (?:b\/)?(.+?) differ$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(diffText)) !== null) {
    if (m[2]) binaryPaths.add(m[2])
    if (m[1]) binaryPaths.add(m[1])
  }
  return binaryPaths
}

export function parseDiff(diffText: string): FileChange[] {
  if (!diffText.trim()) return []
  const binaryPaths = extractBinaryPaths(diffText)
  const parsed = parseDiffLib(diffText)

  return parsed.map((f) => {
    const file = f.to && f.to !== "/dev/null" ? f.to : (f.from ?? "")
    const oldPath = f.from && f.from !== "/dev/null" ? f.from : null
    const isRename = Boolean(
      f.from && f.to && f.from !== f.to &&
      f.from !== "/dev/null" && f.to !== "/dev/null"
    )
    const isDelete = f.deleted === true || f.to === "/dev/null"
    const isBinary = binaryPaths.has(file) || (f.from != null && binaryPaths.has(f.from))
    const isSubmodule = looksLikeSubmodule(f)

    let hunks: Hunk[]
    if (isBinary) {
      hunks = [synthHunk(file, oldPath, "BINARY", { isBinary: true })]
    } else if (isSubmodule) {
      hunks = [synthHunk(file, oldPath, "SUBMODULE", { isSubmodule: true })]
    } else {
      hunks = (f.chunks ?? []).map((c) => {
        const body = renderHunkBody(c)
        return {
          id: computeHunkId({
            file,
            oldStart: c.oldStart, oldLines: c.oldLines,
            newStart: c.newStart, newLines: c.newLines,
            body,
          }),
          file,
          oldPath,
          oldStart: c.oldStart,
          oldLines: c.oldLines,
          newStart: c.newStart,
          newLines: c.newLines,
          body,
          isBinary: false,
          isRename,
          isDelete,
          isSubmodule: false,
          isModeChange: false,
          context: { fileLanguage: detectLanguage(file), isGenerated: false, domainFloor: "A" as const },
        }
      })
    }

    return {
      file,
      oldPath,
      language: detectLanguage(file),
      isBinary,
      isRename,
      isDelete,
      isSubmodule,
      hunks,
    }
  })
}

function renderHunkBody(c: parseDiffLib.Chunk): string {
  const header = `@@ -${c.oldStart},${c.oldLines} +${c.newStart},${c.newLines} @@`
  const lines = c.changes.map((ch) => {
    if (ch.type === "add") return `+${ch.content.replace(/^\+/, "")}`
    if (ch.type === "del") return `-${ch.content.replace(/^-/, "")}`
    return ` ${ch.content.replace(/^ /, "")}`
  })
  return [header, ...lines].join("\n")
}

function looksLikeSubmodule(f: parseDiffLib.File): boolean {
  const chunks = f.chunks ?? []
  if (chunks.length !== 1) return false
  const ch = chunks[0]!
  return ch.changes.some((c) =>
    c.type !== "normal" &&
    typeof c.content === "string" &&
    c.content.includes("Subproject commit ")
  )
}

function synthHunk(
  file: string,
  oldPath: string | null,
  marker: string,
  flags: Partial<Pick<Hunk, "isBinary" | "isSubmodule" | "isModeChange">>,
): Hunk {
  const body = `<<${marker}>>`
  return {
    id: computeHunkId({ file, oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, body }),
    file,
    oldPath,
    oldStart: 0,
    oldLines: 0,
    newStart: 0,
    newLines: 0,
    body,
    isBinary: flags.isBinary ?? false,
    isRename: false,
    isDelete: false,
    isSubmodule: flags.isSubmodule ?? false,
    isModeChange: flags.isModeChange ?? false,
    context: { fileLanguage: detectLanguage(file), isGenerated: false, domainFloor: "A" as const },
  }
}
