import type { Layer } from "../types.js"

export type HunkContext = {
  fileLanguage: string
  isGenerated: boolean
  domainFloor: Layer
}

export type Hunk = {
  id: string
  file: string
  oldPath: string | null
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  body: string
  isBinary: boolean
  isRename: boolean
  isDelete: boolean
  isSubmodule: boolean
  isModeChange: boolean
  context: HunkContext
}

export type FileChange = {
  file: string
  oldPath: string | null
  language: string
  isBinary: boolean
  isRename: boolean
  isDelete: boolean
  isSubmodule: boolean
  hunks: Hunk[]
}
