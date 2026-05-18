import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Classification } from "../promote/types.js"
import type { Usage } from "./classifier.js"

export type CachedBatchResult = {
  classifications: Classification[]
  usage: Usage
}

export interface BatchCache {
  lookup(hunkIds: string[]): CachedBatchResult | undefined
  record(hunkIds: string[], result: CachedBatchResult): void
}

export function hashHunkIds(ids: string[]): string {
  return createHash("sha1").update([...ids].sort().join(",")).digest("hex").slice(0, 16)
}

type FileShape = {
  version: 1
  entries: Array<{ key: string; classifications: Classification[]; usage: Usage }>
}

export class FileBatchCache implements BatchCache {
  private entries = new Map<string, CachedBatchResult>()

  constructor(private filepath: string) {
    if (existsSync(filepath)) {
      try {
        const data = JSON.parse(readFileSync(filepath, "utf8")) as FileShape
        for (const e of data.entries ?? []) {
          this.entries.set(e.key, { classifications: e.classifications, usage: e.usage })
        }
      } catch {
        // Corrupted cache — start fresh. Subsequent writes will overwrite the bad file.
      }
    }
  }

  lookup(hunkIds: string[]): CachedBatchResult | undefined {
    return this.entries.get(hashHunkIds(hunkIds))
  }

  record(hunkIds: string[], result: CachedBatchResult): void {
    this.entries.set(hashHunkIds(hunkIds), result)
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filepath), { recursive: true })
    const data: FileShape = {
      version: 1,
      entries: [...this.entries.entries()].map(([key, v]) => ({
        key, classifications: v.classifications, usage: v.usage,
      })),
    }
    const tmp = this.filepath + ".tmp"
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, this.filepath)
  }
}
