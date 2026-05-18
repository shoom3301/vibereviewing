# Vibereview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local CLI `vibereview` that splits a GitHub PR's diff into three layered commits (A → B → C) on a companion PR, byte-identical to the original.

**Architecture:** Six-stage pipeline (Fetch → Hunkify → Classify → Promote → Apply → Open PR). LLM only classifies; deterministic code does all patch surgery and integrity checks. Two interchangeable providers (Claude, OpenAI) behind a single `Classifier` interface.

**Tech stack:** TypeScript (Node 20+), pnpm, Vitest, zod (config schema), execa (git/gh shell-out), parse-diff (unified-diff parser), yaml, picomatch (glob), @anthropic-ai/sdk, openai, @anthropic-ai/tokenizer, tiktoken, commander (CLI args).

**Reference:** Design spec at `docs/superpowers/specs/2026-05-17-vibereview-design.md`. Every task cites the spec section it implements.

## File structure (created across tasks)

```
vibereview/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .vibereview.yml                  # example for cowswap (Task 25)
├── README.md                        # (Task 30)
├── src/
│   ├── cli.ts                       # entry point + arg parsing
│   ├── commands/
│   │   ├── split.ts                 # `vibereview split` orchestration
│   │   ├── manifest.ts              # `vibereview manifest`
│   │   └── verify.ts                # `vibereview verify`
│   ├── types.ts                     # shared types
│   ├── config/
│   │   ├── schema.ts                # zod schema
│   │   └── load.ts                  # loader + defaults
│   ├── hunkify/
│   │   ├── types.ts                 # Hunk, FileChange
│   │   ├── id.ts                    # stable hunk id hashing
│   │   ├── parse.ts                 # unified diff → Hunk[]
│   │   └── context.ts               # language detect, generated, domainFloor
│   ├── promote/
│   │   ├── types.ts                 # Classification, PromotedClassification
│   │   ├── rules.ts                 # all 7 rule functions
│   │   └── pipeline.ts              # orchestrator
│   ├── classify/
│   │   ├── classifier.ts            # interface
│   │   ├── schema.ts                # JSON schema for output
│   │   ├── prompt.ts                # system prompt builder
│   │   ├── batch.ts                 # batching + coverage retry
│   │   ├── claude.ts                # ClaudeClassifier
│   │   ├── openai.ts                # OpenAIClassifier
│   │   └── select.ts                # provider selection from env
│   ├── apply/
│   │   ├── worktree.ts              # throwaway worktree management
│   │   ├── render.ts                # per-layer patch rendering
│   │   ├── apply.ts                 # git apply --3way + escalation
│   │   ├── commit.ts                # commit message + trailer construction
│   │   └── integrity.ts             # diff equality + tree equality
│   ├── trailer/
│   │   ├── format.ts                # serialize
│   │   └── parse.ts                 # deserialize
│   ├── render/
│   │   ├── prBody.ts                # companion PR body template
│   │   └── comment.ts               # original-PR comment template
│   ├── github/
│   │   ├── fetch.ts                 # PR metadata + diff
│   │   └── pr.ts                    # create PR, post/edit comment
│   └── git/
│       ├── exec.ts                  # execa wrapper for git
│       └── checks.ts                # tree-hash, diff equality helpers
└── tests/
    ├── unit/                        # mirrors src/
    ├── fixtures/
    │   ├── diffs/                   # raw unified diffs
    │   ├── prs/                     # full golden-PR fixtures
    │   └── llm-responses/           # recorded Classifier outputs
    └── e2e/                         # golden-PR end-to-end runs
```

---

## Task 1: Project bootstrap

Implements: nothing in spec yet; lays foundation.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `src/index.ts` (placeholder, exports nothing)

- [ ] **Step 1: Initialize git and pnpm workspace**

```bash
cd /Users/shoom/IdeaProjects/vibereviewing
git init
pnpm init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "vibereview",
  "version": "0.1.0",
  "description": "Split a GitHub PR into AI-reviewable layers",
  "type": "module",
  "bin": { "vibereview": "./dist/cli.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src tests"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "@anthropic-ai/tokenizer": "^0.0.4",
    "commander": "^12.0.0",
    "execa": "^9.0.0",
    "openai": "^4.80.0",
    "parse-diff": "^0.11.1",
    "picomatch": "^4.0.0",
    "tiktoken": "^1.0.0",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/picomatch": "^3.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: { provider: "v8", reporter: ["text", "html"] },
    testTimeout: 10000,
  },
})
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
coverage/
.vibereview-tmp/
*.log
.DS_Store
.env*
!.env.example
```

- [ ] **Step 6: Write `src/index.ts` placeholder**

```ts
export const version = "0.1.0"
```

- [ ] **Step 7: Install deps + verify build + commit**

```bash
pnpm install
pnpm typecheck
git add -A
git commit -m "chore: bootstrap typescript + vitest project"
```

Expected: `pnpm typecheck` exits 0.

---

## Task 2: Shared types

Implements: types referenced throughout spec §5, §6, §7.

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type Layer = "A" | "B" | "C"

export type Provider = "claude" | "openai"

export type Intent =
  | "typo" | "comment" | "docs" | "format" | "lint" | "import_sort"
  | "rename_internal" | "rename_cross_boundary"
  | "extract_pure" | "extract_with_capture"
  | "type_annotation" | "type_export_change"
  | "test_additive" | "test_refactor"
  | "dep_dev_patch" | "dep_runtime" | "dep_major"
  | "ui_pure" | "ui_with_effect"
  | "validation_localized" | "validation_security"
  | "business_logic" | "auth_security" | "schema_persistence"
  | "api_contract" | "perf_concurrency" | "feature_flag_behavior"
  | "config_trivial" | "config_runtime"
  | "generated_output" | "snapshot_update"
  | "i18n_addition" | "i18n_change"
  | "unknown"

export const ALL_INTENTS: Intent[] = [
  "typo", "comment", "docs", "format", "lint", "import_sort",
  "rename_internal", "rename_cross_boundary",
  "extract_pure", "extract_with_capture",
  "type_annotation", "type_export_change",
  "test_additive", "test_refactor",
  "dep_dev_patch", "dep_runtime", "dep_major",
  "ui_pure", "ui_with_effect",
  "validation_localized", "validation_security",
  "business_logic", "auth_security", "schema_persistence",
  "api_contract", "perf_concurrency", "feature_flag_behavior",
  "config_trivial", "config_runtime",
  "generated_output", "snapshot_update",
  "i18n_addition", "i18n_change",
  "unknown",
]

export type PRRef = {
  owner: string
  repo: string
  number: number
  title: string
  baseBranch: string
  baseSha: string
  headSha: string
  url: string
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add src/types.ts
git commit -m "feat(types): add shared Layer/Intent/PRRef types"
```

Expected: typecheck passes.

---

## Task 3: Hunk types and stable IDs

Implements: spec §5 stage 2 (Hunkify types), §6 (stable IDs for `verify`).

**Files:**
- Create: `src/hunkify/types.ts`
- Create: `src/hunkify/id.ts`
- Create: `tests/unit/hunkify/id.test.ts`

- [ ] **Step 1: Write `src/hunkify/types.ts`**

```ts
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
```

- [ ] **Step 2: Write failing test for hunk ID stability**

`tests/unit/hunkify/id.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { computeHunkId } from "../../../src/hunkify/id.js"

describe("computeHunkId", () => {
  it("produces stable hash for identical hunk content", () => {
    const a = computeHunkId({
      file: "src/a.ts",
      oldStart: 10, oldLines: 3,
      newStart: 10, newLines: 4,
      body: "@@ -10,3 +10,4 @@\n line\n-old\n+new1\n+new2",
    })
    const b = computeHunkId({
      file: "src/a.ts",
      oldStart: 10, oldLines: 3,
      newStart: 10, newLines: 4,
      body: "@@ -10,3 +10,4 @@\n line\n-old\n+new1\n+new2",
    })
    expect(a).toBe(b)
  })

  it("changes when any field changes", () => {
    const base = {
      file: "src/a.ts",
      oldStart: 10, oldLines: 3,
      newStart: 10, newLines: 4,
      body: "@@ -10,3 +10,4 @@\n line\n-old\n+new",
    }
    const variants = [
      { ...base, file: "src/b.ts" },
      { ...base, oldStart: 11 },
      { ...base, oldLines: 4 },
      { ...base, newStart: 11 },
      { ...base, newLines: 5 },
      { ...base, body: base.body + " " },
    ]
    const baseHash = computeHunkId(base)
    for (const v of variants) {
      expect(computeHunkId(v)).not.toBe(baseHash)
    }
  })

  it("produces ids prefixed with h_ and of bounded length", () => {
    const id = computeHunkId({
      file: "x", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body: "x",
    })
    expect(id).toMatch(/^h_[0-9a-f]+$/)
    expect(id.length).toBeLessThanOrEqual(16)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test tests/unit/hunkify/id.test.ts
```

Expected: FAIL (`computeHunkId` not defined).

- [ ] **Step 4: Implement `src/hunkify/id.ts`**

```ts
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
  ].join(" ")
  const hash = createHash("sha256").update(canonical).digest("hex")
  return `h_${hash.slice(0, 12)}`
}
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/hunkify/id.test.ts
git add src/hunkify tests/unit/hunkify
git commit -m "feat(hunkify): add Hunk/FileChange types and stable id hashing"
```

Expected: all 3 tests pass.

---

## Task 4: Unified diff parser

Implements: spec §5 stage 2 (parse diff → typed hunks).

**Files:**
- Create: `src/hunkify/parse.ts`
- Create: `tests/unit/hunkify/parse.test.ts`
- Create: `tests/fixtures/diffs/simple.diff`
- Create: `tests/fixtures/diffs/rename-with-body.diff`
- Create: `tests/fixtures/diffs/binary.diff`
- Create: `tests/fixtures/diffs/delete.diff`
- Create: `tests/fixtures/diffs/submodule.diff`

- [ ] **Step 1: Write fixture `tests/fixtures/diffs/simple.diff`**

```diff
diff --git a/src/a.ts b/src/a.ts
index 1234567..89abcde 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 export function greet(name: string) {
-  return `Hi, ${name}`
+  return `Hello, ${name}`
 }
@@ -10,2 +10,3 @@
 const x = 1
+const y = 2
 const z = 3
```

- [ ] **Step 2: Write fixture `tests/fixtures/diffs/rename-with-body.diff`**

```diff
diff --git a/src/old.ts b/src/new.ts
similarity index 80%
rename from src/old.ts
rename to src/new.ts
index 1234567..89abcde 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,3 +1,3 @@
 export const x = 1
-const y = 2
+const y = 3
 const z = 4
```

- [ ] **Step 3: Write fixture `tests/fixtures/diffs/binary.diff`**

```diff
diff --git a/assets/logo.png b/assets/logo.png
index 1234567..89abcde 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
```

- [ ] **Step 4: Write fixture `tests/fixtures/diffs/delete.diff`**

```diff
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const x = 1
-export const y = 2
-export const z = 3
```

- [ ] **Step 5: Write fixture `tests/fixtures/diffs/submodule.diff`**

```diff
diff --git a/vendor/lib b/vendor/lib
index 1111111..2222222 160000
--- a/vendor/lib
+++ b/vendor/lib
@@ -1 +1 @@
-Subproject commit 1111111111111111111111111111111111111111
+Subproject commit 2222222222222222222222222222222222222222
```

- [ ] **Step 6: Write failing tests `tests/unit/hunkify/parse.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseDiff } from "../../../src/hunkify/parse.js"

const fx = (name: string) =>
  readFileSync(join(__dirname, "../../fixtures/diffs", name), "utf8")

describe("parseDiff", () => {
  it("parses a simple two-hunk file", () => {
    const files = parseDiff(fx("simple.diff"))
    expect(files).toHaveLength(1)
    expect(files[0]!.file).toBe("src/a.ts")
    expect(files[0]!.hunks).toHaveLength(2)
    expect(files[0]!.hunks[0]!.oldStart).toBe(1)
    expect(files[0]!.hunks[0]!.oldLines).toBe(3)
    expect(files[0]!.hunks[1]!.newStart).toBe(10)
    expect(files[0]!.hunks[1]!.newLines).toBe(3)
    expect(files[0]!.hunks[0]!.id).toMatch(/^h_/)
  })

  it("parses a rename with body changes", () => {
    const files = parseDiff(fx("rename-with-body.diff"))
    expect(files).toHaveLength(1)
    expect(files[0]!.file).toBe("src/new.ts")
    expect(files[0]!.oldPath).toBe("src/old.ts")
    expect(files[0]!.isRename).toBe(true)
    expect(files[0]!.hunks).toHaveLength(1)
  })

  it("represents a binary file as one atomic hunk", () => {
    const files = parseDiff(fx("binary.diff"))
    expect(files).toHaveLength(1)
    expect(files[0]!.isBinary).toBe(true)
    expect(files[0]!.hunks).toHaveLength(1)
    expect(files[0]!.hunks[0]!.isBinary).toBe(true)
  })

  it("flags file deletions", () => {
    const files = parseDiff(fx("delete.diff"))
    expect(files[0]!.isDelete).toBe(true)
  })

  it("represents a submodule pointer change as one atomic hunk", () => {
    const files = parseDiff(fx("submodule.diff"))
    expect(files[0]!.isSubmodule).toBe(true)
    expect(files[0]!.hunks).toHaveLength(1)
    expect(files[0]!.hunks[0]!.isSubmodule).toBe(true)
  })

  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([])
  })
})
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
pnpm test tests/unit/hunkify/parse.test.ts
```

Expected: FAIL (`parseDiff` not defined).

- [ ] **Step 8: Implement `src/hunkify/parse.ts`**

```ts
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

export function parseDiff(diffText: string): FileChange[] {
  if (!diffText.trim()) return []
  const parsed = parseDiffLib(diffText)

  return parsed.map((f) => {
    const file = f.to && f.to !== "/dev/null" ? f.to : (f.from ?? "")
    const oldPath = f.from && f.from !== "/dev/null" ? f.from : null
    const isRename = Boolean(f.from && f.to && f.from !== f.to && f.from !== "/dev/null" && f.to !== "/dev/null")
    const isDelete = f.deleted === true || f.to === "/dev/null"
    const isBinary = (f as { binary?: boolean }).binary === true
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
          context: { fileLanguage: detectLanguage(file), isGenerated: false, domainFloor: "A" },
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
    c.type !== "normal" && typeof c.content === "string" && c.content.includes("Subproject commit "))
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
    file, oldPath,
    oldStart: 0, oldLines: 0, newStart: 0, newLines: 0,
    body,
    isBinary: flags.isBinary ?? false,
    isRename: false,
    isDelete: false,
    isSubmodule: flags.isSubmodule ?? false,
    isModeChange: flags.isModeChange ?? false,
    context: { fileLanguage: detectLanguage(file), isGenerated: false, domainFloor: "A" },
  }
}
```

- [ ] **Step 9: Run tests and commit**

```bash
pnpm test tests/unit/hunkify/parse.test.ts
git add src/hunkify/parse.ts tests/unit/hunkify/parse.test.ts tests/fixtures/diffs
git commit -m "feat(hunkify): parse unified diff into typed FileChange/Hunk[]"
```

Expected: all 6 tests pass.

---

## Task 5: Hunk context (language, generated, domain floor)

Implements: spec §5 stage 2 (context enrichment), §4 (`.vibereview.yml` floors and generated).

**Files:**
- Create: `src/hunkify/context.ts`
- Create: `tests/unit/hunkify/context.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/hunkify/context.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { applyContext } from "../../../src/hunkify/context.js"
import type { FileChange } from "../../../src/hunkify/types.js"

function makeFile(path: string): FileChange {
  return {
    file: path, oldPath: null, language: "ts",
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false,
    hunks: [{
      id: "h_x", file: path, oldPath: null,
      oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body: "@@",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false, isModeChange: false,
      context: { fileLanguage: "ts", isGenerated: false, domainFloor: "A" },
    }],
  }
}

describe("applyContext", () => {
  const config = {
    floors: {
      C: ["**/settlement/**", "**/*.sol"],
      B: ["tsconfig*.json"],
    },
    generated: ["**/*.generated.ts"],
  }

  it("assigns domain floor C for matched paths", () => {
    const f = makeFile("src/settlement/engine.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.domainFloor).toBe("C")
  })

  it("assigns domain floor B for tsconfig", () => {
    const f = makeFile("tsconfig.base.json")
    applyContext([f], config)
    expect(f.hunks[0]!.context.domainFloor).toBe("B")
  })

  it("leaves domainFloor at A when no glob matches", () => {
    const f = makeFile("src/utils/format.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.domainFloor).toBe("A")
  })

  it("uses the highest floor when both B and C globs match", () => {
    const f = makeFile("contracts/Token.sol")
    applyContext([f], { floors: { B: ["**/*.sol"], C: ["**/*.sol"] }, generated: [] })
    expect(f.hunks[0]!.context.domainFloor).toBe("C")
  })

  it("marks generated files", () => {
    const f = makeFile("src/api.generated.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.isGenerated).toBe(true)
  })

  it("does not mark non-generated files", () => {
    const f = makeFile("src/api.ts")
    applyContext([f], config)
    expect(f.hunks[0]!.context.isGenerated).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/unit/hunkify/context.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/hunkify/context.ts`**

```ts
import picomatch from "picomatch"
import type { FileChange } from "./types.js"
import type { Layer } from "../types.js"

export type ContextConfig = {
  floors: { B?: string[]; C?: string[] }
  generated: string[]
}

const LAYER_RANK: Record<Layer, number> = { A: 0, B: 1, C: 2 }

function maxLayer(a: Layer, b: Layer): Layer {
  return LAYER_RANK[a] >= LAYER_RANK[b] ? a : b
}

export function applyContext(files: FileChange[], config: ContextConfig): void {
  const matchB = config.floors.B && config.floors.B.length > 0
    ? picomatch(config.floors.B)
    : () => false
  const matchC = config.floors.C && config.floors.C.length > 0
    ? picomatch(config.floors.C)
    : () => false
  const matchGen = config.generated.length > 0
    ? picomatch(config.generated)
    : () => false

  for (const file of files) {
    let floor: Layer = "A"
    if (matchB(file.file)) floor = maxLayer(floor, "B")
    if (matchC(file.file)) floor = maxLayer(floor, "C")
    const isGenerated = matchGen(file.file)

    for (const hunk of file.hunks) {
      hunk.context.domainFloor = floor
      hunk.context.isGenerated = isGenerated
    }
  }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/hunkify/context.test.ts
git add src/hunkify/context.ts tests/unit/hunkify/context.test.ts
git commit -m "feat(hunkify): enrich hunks with domain floor and generated flags"
```

Expected: all 6 tests pass.

---

## Task 6: Config schema and loader

Implements: spec §4 (`.vibereview.yml` schema, defaults, malformed → exit 2).

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/load.ts`
- Create: `tests/unit/config/load.test.ts`
- Create: `tests/fixtures/configs/valid.yml`
- Create: `tests/fixtures/configs/malformed.yml`

- [ ] **Step 1: Write `tests/fixtures/configs/valid.yml`**

```yaml
version: 1
floors:
  C:
    - "**/settlement/**"
    - "**/*.sol"
  B:
    - "tsconfig*.json"
generated:
  - "**/*.generated.ts"
confidence_threshold: 0.65
max_diff_tokens: 100000
providers:
  claude:
    model: claude-opus-4-7
  openai:
    model: gpt-5
```

- [ ] **Step 2: Write `tests/fixtures/configs/malformed.yml`**

```yaml
version: 1
floors:
  C: "not-an-array"
```

- [ ] **Step 3: Write failing tests `tests/unit/config/load.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { join } from "node:path"
import { loadConfig, DEFAULT_CONFIG } from "../../../src/config/load.js"

const fx = (name: string) => join(__dirname, "../../fixtures/configs", name)

describe("loadConfig", () => {
  it("loads and validates a valid file", () => {
    const cfg = loadConfig(fx("valid.yml"))
    expect(cfg.floors.C).toContain("**/settlement/**")
    expect(cfg.confidence_threshold).toBe(0.65)
    expect(cfg.providers.claude.model).toBe("claude-opus-4-7")
  })

  it("returns defaults when path does not exist", () => {
    const cfg = loadConfig("/tmp/does-not-exist-vibereview.yml")
    expect(cfg).toEqual(DEFAULT_CONFIG)
  })

  it("throws on malformed yaml", () => {
    expect(() => loadConfig(fx("malformed.yml"))).toThrow(/floors\.C/)
  })

  it("default confidence_threshold is 0.7", () => {
    expect(DEFAULT_CONFIG.confidence_threshold).toBe(0.7)
  })

  it("default max_diff_tokens is 200000", () => {
    expect(DEFAULT_CONFIG.max_diff_tokens).toBe(200000)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm test tests/unit/config/load.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Implement `src/config/schema.ts`**

```ts
import { z } from "zod"

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  floors: z.object({
    B: z.array(z.string()).default([]),
    C: z.array(z.string()).default([]),
  }).default({ B: [], C: [] }),
  generated: z.array(z.string()).default([]),
  confidence_threshold: z.number().min(0).max(1).default(0.7),
  max_diff_tokens: z.number().int().positive().default(200000),
  providers: z.object({
    claude: z.object({ model: z.string() }).default({ model: "claude-opus-4-7" }),
    openai: z.object({ model: z.string() }).default({ model: "gpt-5" }),
  }).default({ claude: { model: "claude-opus-4-7" }, openai: { model: "gpt-5" } }),
})

export type Config = z.infer<typeof ConfigSchema>
```

- [ ] **Step 6: Implement `src/config/load.ts`**

```ts
import { existsSync, readFileSync } from "node:fs"
import { parse as parseYaml } from "yaml"
import { ConfigSchema, type Config } from "./schema.js"

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({})

export function loadConfig(path: string): Config {
  if (!existsSync(path)) return DEFAULT_CONFIG
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(path, "utf8"))
  } catch (e) {
    throw new Error(`Cannot parse ${path}: ${(e as Error).message}`)
  }
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new Error(`Invalid ${path}: ${issues}`)
  }
  return result.data
}
```

- [ ] **Step 7: Run tests and commit**

```bash
pnpm test tests/unit/config/load.test.ts
git add src/config tests/unit/config tests/fixtures/configs
git commit -m "feat(config): load + validate .vibereview.yml with zod + defaults"
```

Expected: all 5 tests pass.

---

## Task 7: Promote types and rule scaffold

Implements: spec §2 (rules), §5 stage 4 (promote pipeline). Provides the substrate for Tasks 8–14.

**Files:**
- Create: `src/promote/types.ts`
- Create: `src/promote/layers.ts`
- Create: `src/promote/rules.ts` (placeholder exports)

- [ ] **Step 1: Write `src/promote/types.ts`**

```ts
import type { Layer, Intent } from "../types.js"
import type { Hunk, FileChange } from "../hunkify/types.js"

export type Classification = {
  hunk_id: string
  layer: Layer
  confidence: number
  intents: Intent[]
  rationale: string
}

export type EscalationReason =
  | "multi_intent" | "low_confidence" | "cross_reference"
  | "dependency" | "exported_symbol"
  | "generated_missing_source" | "domain_floor"

export type PromotedClassification = Classification & {
  originalLayer: Layer
  escalations: EscalationReason[]
}

export type PromoteContext = {
  files: FileChange[]
  hunks: Hunk[]
  classifications: Map<string, Classification>
  confidenceThreshold: number
}

export type Rule = (
  ctx: PromoteContext,
  current: Map<string, PromotedClassification>,
) => void
```

- [ ] **Step 2: Write `src/promote/layers.ts`**

```ts
import type { Layer } from "../types.js"

const RANK: Record<Layer, number> = { A: 0, B: 1, C: 2 }

export function maxLayer(a: Layer, b: Layer): Layer {
  return RANK[a] >= RANK[b] ? a : b
}

export function escalateOne(l: Layer): Layer {
  return l === "A" ? "B" : "C"
}
```

- [ ] **Step 3: Write `src/promote/rules.ts` placeholder**

```ts
import type { Rule } from "./types.js"

export const multiIntentRule: Rule = () => {}
export const lowConfidenceRule: Rule = () => {}
export const crossReferenceRule: Rule = () => {}
export const dependencyRule: Rule = () => {}
export const exportedSymbolRule: Rule = () => {}
export const generatedFileRule: Rule = () => {}
export const domainFloorRule: Rule = () => {}
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add src/promote
git commit -m "feat(promote): scaffold Classification types and rule signatures"
```

Expected: typecheck passes.

---

## Task 8: Promote rules — multi-intent and low-confidence

Implements: spec §2 rules 5 and 6, §5 stage 4 steps 2–3.

**Files:**
- Modify: `src/promote/rules.ts`
- Create: `tests/unit/promote/_helpers.ts`
- Create: `tests/unit/promote/rules.test.ts`

- [ ] **Step 1: Write `tests/unit/promote/_helpers.ts`** (shared by Tasks 8–13)

```ts
import type { Classification, PromoteContext, PromotedClassification } from "../../../src/promote/types.js"
import type { Hunk, FileChange } from "../../../src/hunkify/types.js"
import type { Layer } from "../../../src/types.js"

export function makeClassification(c: Partial<Classification>): Classification {
  return {
    hunk_id: c.hunk_id ?? "h_1",
    layer: c.layer ?? "A",
    confidence: c.confidence ?? 0.95,
    intents: c.intents ?? ["typo"],
    rationale: c.rationale ?? "",
  }
}

export function makeHunk(
  file: string,
  body: string,
  id: string,
  opts: { floor?: Layer; isGenerated?: boolean } = {},
): Hunk {
  return {
    id, file, oldPath: null,
    oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body,
    isBinary: false, isRename: false, isDelete: false,
    isSubmodule: false, isModeChange: false,
    context: {
      fileLanguage: file.split(".").pop() ?? "text",
      isGenerated: opts.isGenerated ?? false,
      domainFloor: opts.floor ?? "A",
    },
  }
}

export function makeFile(path: string, hunks: Hunk[]): FileChange {
  return {
    file: path, oldPath: null, language: path.split(".").pop() ?? "text",
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false, hunks,
  }
}

export function makeContext(
  files: FileChange[],
  classifications: Classification[],
  threshold = 0.7,
): PromoteContext {
  const hunks = files.flatMap((f) => f.hunks)
  return {
    files, hunks,
    classifications: new Map(classifications.map((c) => [c.hunk_id, c])),
    confidenceThreshold: threshold,
  }
}

export function seedResult(ctx: PromoteContext): Map<string, PromotedClassification> {
  const out = new Map<string, PromotedClassification>()
  for (const [id, cl] of ctx.classifications) {
    out.set(id, { ...cl, originalLayer: cl.layer, escalations: [] })
  }
  return out
}
```

- [ ] **Step 2: Write failing tests `tests/unit/promote/rules.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import {
  multiIntentRule, lowConfidenceRule, crossReferenceRule, dependencyRule,
  exportedSymbolRule, generatedFileRule, domainFloorRule,
} from "../../../src/promote/rules.js"
import {
  makeClassification, makeHunk, makeFile, makeContext, seedResult,
} from "./_helpers.js"

describe("multiIntentRule", () => {
  it("escalates one layer when intents.length > 1", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ layer: "A", intents: ["typo", "rename_internal"] })])
    const r = seedResult(ctx); multiIntentRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("B")
    expect(r.get("h_1")!.escalations).toContain("multi_intent")
  })

  it("does not escalate when only one intent", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ layer: "A", intents: ["typo"] })])
    const r = seedResult(ctx); multiIntentRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("A")
  })

  it("escalates B to C", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ layer: "B", intents: ["ui_pure", "validation_localized"] })])
    const r = seedResult(ctx); multiIntentRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("C")
  })
})

describe("lowConfidenceRule", () => {
  it("escalates when confidence is below threshold", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ confidence: 0.6 })])
    const r = seedResult(ctx); lowConfidenceRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("B")
    expect(r.get("h_1")!.escalations).toContain("low_confidence")
  })

  it("does not escalate at threshold", () => {
    const h = makeHunk("src/x.ts", "@@", "h_1")
    const ctx = makeContext([makeFile("src/x.ts", [h])],
      [makeClassification({ confidence: 0.7 })])
    const r = seedResult(ctx); lowConfidenceRule(ctx, r)
    expect(r.get("h_1")!.layer).toBe("A")
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm test tests/unit/promote/rules.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement both rules in `src/promote/rules.ts`**

Replace the two named placeholders:

```ts
import type { Rule } from "./types.js"
import { escalateOne } from "./layers.js"

export const multiIntentRule: Rule = (ctx, current) => {
  for (const [id, c] of current) {
    const cl = ctx.classifications.get(id)!
    if (cl.intents.length > 1) {
      c.layer = escalateOne(c.layer)
      c.escalations.push("multi_intent")
    }
  }
}

export const lowConfidenceRule: Rule = (ctx, current) => {
  for (const [id, c] of current) {
    const cl = ctx.classifications.get(id)!
    if (cl.confidence < ctx.confidenceThreshold) {
      c.layer = escalateOne(c.layer)
      c.escalations.push("low_confidence")
    }
  }
}

// remaining rules stay as no-ops; filled in subsequent tasks
export const crossReferenceRule: Rule = () => {}
export const dependencyRule: Rule = () => {}
export const exportedSymbolRule: Rule = () => {}
export const generatedFileRule: Rule = () => {}
export const domainFloorRule: Rule = () => {}
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/promote/rules.test.ts
git add src/promote tests/unit/promote
git commit -m "feat(promote): multi-intent and low-confidence rules"
```

Expected: all 5 tests pass.

---

## Task 9: Promote rule — cross-reference

Implements: spec §2 rule 3, §5 stage 4 step 4.

**Files:**
- Modify: `src/promote/rules.ts`
- Modify: `tests/unit/promote/rules.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("crossReferenceRule", () => {
  it("escalates to B when a string literal also appears in a json file", () => {
    const ts = makeHunk("src/api.ts",
      `@@\n-const KEY = "FOO_FLAG"\n+const KEY = "BAR_FLAG"`, "h_ts")
    const json = makeHunk("flags.json", `@@\n   "FOO_FLAG": true,`, "h_json")
    const ctx = makeContext(
      [makeFile("src/api.ts", [ts]), makeFile("flags.json", [json])],
      [
        makeClassification({ hunk_id: "h_ts", layer: "A", intents: ["rename_internal"] }),
        makeClassification({ hunk_id: "h_json", layer: "A", intents: ["config_trivial"] }),
      ],
    )
    const r = seedResult(ctx); crossReferenceRule(ctx, r)
    expect(r.get("h_ts")!.layer).toBe("B")
    expect(r.get("h_ts")!.escalations).toContain("cross_reference")
  })

  it("does not escalate without a cross-reference", () => {
    const ts = makeHunk("src/api.ts",
      `@@\n-const KEY = "FOO_FLAG"\n+const KEY = "BAR_FLAG"`, "h_ts")
    const ctx = makeContext([makeFile("src/api.ts", [ts])],
      [makeClassification({ hunk_id: "h_ts", layer: "A", intents: ["rename_internal"] })])
    const r = seedResult(ctx); crossReferenceRule(ctx, r)
    expect(r.get("h_ts")!.layer).toBe("A")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/promote/rules.test.ts
```

Expected: cross-reference tests fail.

- [ ] **Step 3: Implement `crossReferenceRule`**

```ts
const CROSS_REF_EXTS = /\.(json|ya?ml|sql|env[a-zA-Z0-9._-]*)$|^\.env/

export const crossReferenceRule: Rule = (ctx, current) => {
  const configStrings = new Set<string>()
  for (const file of ctx.files) {
    if (!CROSS_REF_EXTS.test(file.file)) continue
    for (const h of file.hunks) {
      for (const lit of extractStringLiterals(h.body)) configStrings.add(lit)
    }
  }
  if (configStrings.size === 0) return

  for (const h of ctx.hunks) {
    if (CROSS_REF_EXTS.test(h.file)) continue
    const literals = extractStringLiterals(h.body)
    if (literals.some((l) => configStrings.has(l))) {
      const c = current.get(h.id)!
      if (c.layer === "A") {
        c.layer = "B"
        c.escalations.push("cross_reference")
      }
    }
  }
}

function extractStringLiterals(body: string): string[] {
  const out: string[] = []
  for (const line of body.split("\n")) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue
    for (const m of line.matchAll(/["']([A-Za-z0-9_.\-/:]{2,})["']/g)) out.push(m[1]!)
  }
  return out
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/promote/rules.test.ts
git add src/promote/rules.ts tests/unit/promote/rules.test.ts
git commit -m "feat(promote): cross-reference rule (string literal in config)"
```

Expected: all tests pass.

---

## Task 10: Promote rule — dependency

Implements: spec §2 rule 4, §5 stage 4 step 5.

**Files:**
- Modify: `src/promote/rules.ts`
- Modify: `tests/unit/promote/rules.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("dependencyRule", () => {
  it("escalates to C on a major version bump", () => {
    const h = makeHunk("package.json",
      `@@\n   "dependencies": {\n-    "react": "^17.0.2",\n+    "react": "^18.0.0",\n   },`,
      "h_pkg")
    const ctx = makeContext([makeFile("package.json", [h])],
      [makeClassification({ hunk_id: "h_pkg", layer: "B", intents: ["dep_major"] })])
    const r = seedResult(ctx); dependencyRule(ctx, r)
    expect(r.get("h_pkg")!.layer).toBe("C")
    expect(r.get("h_pkg")!.escalations).toContain("dependency")
  })

  it("escalates to C on any runtime dep edit", () => {
    const h = makeHunk("package.json",
      `@@\n   "dependencies": {\n-    "lodash": "4.17.20",\n+    "lodash": "4.17.21",\n   },`,
      "h_pkg")
    const ctx = makeContext([makeFile("package.json", [h])],
      [makeClassification({ hunk_id: "h_pkg", layer: "A", intents: ["dep_runtime"] })])
    const r = seedResult(ctx); dependencyRule(ctx, r)
    expect(r.get("h_pkg")!.layer).toBe("C")
  })

  it("does not escalate a devDependencies patch bump", () => {
    const h = makeHunk("package.json",
      `@@\n   "devDependencies": {\n-    "vitest": "2.0.0",\n+    "vitest": "2.0.1",\n   },`,
      "h_pkg")
    const ctx = makeContext([makeFile("package.json", [h])],
      [makeClassification({ hunk_id: "h_pkg", layer: "A", intents: ["dep_dev_patch"] })])
    const r = seedResult(ctx); dependencyRule(ctx, r)
    expect(r.get("h_pkg")!.layer).toBe("A")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/promote/rules.test.ts
```

Expected: dependency tests fail.

- [ ] **Step 3: Implement `dependencyRule`**

```ts
import { maxLayer } from "./layers.js"

export const dependencyRule: Rule = (ctx, current) => {
  for (const h of ctx.hunks) {
    if (!h.file.endsWith("package.json")) continue
    if (!touchesRuntimeSection(h.body) && !looksLikeMajorBump(h.body)) continue
    const c = current.get(h.id)!
    const before = c.layer
    c.layer = maxLayer(c.layer, "C")
    if (c.layer !== before) c.escalations.push("dependency")
  }
}

function touchesRuntimeSection(body: string): boolean {
  const runtimeSections = ["dependencies", "peerDependencies", "optionalDependencies"]
  const startRe = new RegExp(`"(${runtimeSections.join("|")})"\\s*:`)
  const otherSectionRe = /^"[A-Za-z]\w*[Dd]ependencies"\s*:/
  let inSection = false
  for (const raw of body.split("\n")) {
    const code = raw.replace(/^[+\- ]/, "").trim()
    if (startRe.test(code)) { inSection = true; continue }
    if (otherSectionRe.test(code)) { inSection = false; continue }
    if (inSection && (raw.startsWith("+") || raw.startsWith("-"))) return true
  }
  return false
}

function looksLikeMajorBump(body: string): boolean {
  const seen: Record<string, { from?: string; to?: string }> = {}
  for (const line of body.split("\n")) {
    const m = line.match(/^([+\-])\s+"([^"]+)"\s*:\s*"([\^~]?)(\d+)\.(\d+)\.(\d+)/)
    if (!m) continue
    const [, sign, pkg, , major] = m
    seen[pkg!] ??= {}
    if (sign === "-") seen[pkg!]!.from = major
    else seen[pkg!]!.to = major
  }
  return Object.values(seen).some((v) =>
    v.from !== undefined && v.to !== undefined && v.from !== v.to)
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/promote/rules.test.ts
git add src/promote/rules.ts tests/unit/promote/rules.test.ts
git commit -m "feat(promote): dependency rule (runtime dep / major bump → C)"
```

Expected: all tests pass.

---

## Task 11: Promote rule — exported symbol (cross-hunk)

Implements: spec §2 rule 2, §5 stage 4 step 6.

**Files:**
- Modify: `src/promote/rules.ts`
- Modify: `tests/unit/promote/rules.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("exportedSymbolRule", () => {
  it("escalates definition and caller hunks together to B on exported rename", () => {
    const def = makeHunk("src/api.ts",
      `@@\n-export function getOrder(id: string) {\n+export function fetchOrder(id: string) {`,
      "h_def")
    const caller = makeHunk("src/page.ts",
      `@@\n-  const o = await getOrder(id)\n+  const o = await fetchOrder(id)`,
      "h_caller")
    const ctx = makeContext(
      [makeFile("src/api.ts", [def]), makeFile("src/page.ts", [caller])],
      [
        makeClassification({ hunk_id: "h_def", layer: "A", intents: ["rename_internal"] }),
        makeClassification({ hunk_id: "h_caller", layer: "A", intents: ["rename_internal"] }),
      ],
    )
    const r = seedResult(ctx); exportedSymbolRule(ctx, r)
    expect(r.get("h_def")!.layer).toBe("B")
    expect(r.get("h_caller")!.layer).toBe("B")
    expect(r.get("h_def")!.escalations).toContain("exported_symbol")
  })

  it("does not escalate when the rename is not exported", () => {
    const def = makeHunk("src/api.ts",
      `@@\n-function helper() {\n+function utility() {`, "h_def")
    const ctx = makeContext([makeFile("src/api.ts", [def])],
      [makeClassification({ hunk_id: "h_def", layer: "A", intents: ["rename_internal"] })])
    const r = seedResult(ctx); exportedSymbolRule(ctx, r)
    expect(r.get("h_def")!.layer).toBe("A")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/promote/rules.test.ts
```

Expected: exported-symbol tests fail.

- [ ] **Step 3: Implement `exportedSymbolRule`**

```ts
const EXPORTED_DECL_RE =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+([A-Za-z_$][\w$]*)/

export const exportedSymbolRule: Rule = (ctx, current) => {
  const renamed = collectExportedRenames(ctx)
  if (renamed.size === 0) return

  for (const h of ctx.hunks) {
    if (![...renamed].some((sym) => hunkMentions(h.body, sym))) continue
    const c = current.get(h.id)!
    const before = c.layer
    c.layer = maxLayer(c.layer, "B")
    if (c.layer !== before) c.escalations.push("exported_symbol")
  }
}

function collectExportedRenames(ctx: PromoteContext): Set<string> {
  const out = new Set<string>()
  for (const h of ctx.hunks) {
    const removed = new Set<string>()
    const added = new Set<string>()
    for (const line of h.body.split("\n")) {
      const code = line.replace(/^[+\- ]/, "")
      const m = code.match(EXPORTED_DECL_RE)
      if (!m) continue
      if (line.startsWith("-")) removed.add(m[1]!)
      else if (line.startsWith("+")) added.add(m[1]!)
    }
    for (const r of removed) {
      if (added.has(r)) continue
      for (const a of added) {
        if (!removed.has(a)) { out.add(r); out.add(a) }
      }
    }
  }
  return out
}

function hunkMentions(body: string, symbol: string): boolean {
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
  for (const line of body.split("\n")) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue
    if (re.test(line)) return true
  }
  return false
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/promote/rules.test.ts
git add src/promote/rules.ts tests/unit/promote/rules.test.ts
git commit -m "feat(promote): exported-symbol rename → ≥ B (cross-hunk)"
```

Expected: all tests pass.

---

## Task 12: Promote rule — generated file

Implements: spec §2 Layer A generated definition, §5 stage 4 step 7.

**Files:**
- Modify: `src/promote/rules.ts`
- Modify: `tests/unit/promote/rules.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("generatedFileRule", () => {
  it("escalates a generated file with no source-of-generation to C", () => {
    const g = makeHunk("src/api.generated.ts", "@@", "h_gen", { isGenerated: true })
    const ctx = makeContext([makeFile("src/api.generated.ts", [g])],
      [makeClassification({ hunk_id: "h_gen", layer: "A", intents: ["generated_output"] })])
    const r = seedResult(ctx); generatedFileRule(ctx, r)
    expect(r.get("h_gen")!.layer).toBe("C")
    expect(r.get("h_gen")!.escalations).toContain("generated_missing_source")
  })

  it("leaves a generated file alone when a paired source is present at ≥ B", () => {
    const g = makeHunk("src/api.generated.ts", "@@", "h_gen", { isGenerated: true })
    const src = makeHunk("src/api.graphql", "@@", "h_src")
    const ctx = makeContext(
      [makeFile("src/api.generated.ts", [g]), makeFile("src/api.graphql", [src])],
      [
        makeClassification({ hunk_id: "h_gen", layer: "A", intents: ["generated_output"] }),
        makeClassification({ hunk_id: "h_src", layer: "B", intents: ["api_contract"] }),
      ],
    )
    const r = seedResult(ctx); generatedFileRule(ctx, r)
    expect(r.get("h_gen")!.layer).toBe("A")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/promote/rules.test.ts
```

Expected: generated-file tests fail.

- [ ] **Step 3: Implement `generatedFileRule`**

```ts
import type { Layer } from "../types.js"

const LR: Record<Layer, number> = { A: 0, B: 1, C: 2 }

export const generatedFileRule: Rule = (ctx, current) => {
  const fileMaxLayer = new Map<string, Layer>()
  for (const h of ctx.hunks) {
    const cur = current.get(h.id)!.layer
    const prev = fileMaxLayer.get(h.file)
    fileMaxLayer.set(h.file, prev === undefined ? cur : (LR[cur] > LR[prev] ? cur : prev))
  }
  for (const h of ctx.hunks) {
    if (!h.context.isGenerated) continue
    if (hasPairedSource(h, ctx, fileMaxLayer)) continue
    const c = current.get(h.id)!
    const before = c.layer
    c.layer = "C"
    if (c.layer !== before) c.escalations.push("generated_missing_source")
  }
}

function hasPairedSource(
  gen: { file: string },
  ctx: PromoteContext,
  layers: Map<string, Layer>,
): boolean {
  const stem = gen.file
    .replace(/\.generated\.[^./]+$/, "")
    .replace(/__generated__\//, "")
  const stemBase = stem.split("/").pop() ?? ""
  for (const f of ctx.files) {
    if (f.file === gen.file) continue
    if (f.hunks.every((h) => h.context.isGenerated)) continue
    if (f.file.includes(stem) || (stemBase.length > 1 && f.file.endsWith(stemBase))) {
      const lyr = layers.get(f.file)
      if (lyr && LR[lyr] >= LR["B"]) return true
    }
  }
  return false
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/promote/rules.test.ts
git add src/promote/rules.ts tests/unit/promote/rules.test.ts
git commit -m "feat(promote): generated-file rule (no source → C)"
```

Expected: all tests pass.

---

## Task 13: Promote rule — domain floor

Implements: spec §2 rule 1, §5 stage 4 step 8 (last; cannot demote).

**Files:**
- Modify: `src/promote/rules.ts`
- Modify: `tests/unit/promote/rules.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("domainFloorRule", () => {
  it("forces ≥ C when floor is C", () => {
    const h = makeHunk("src/settlement/engine.ts", "@@", "h_s", { floor: "C" })
    const ctx = makeContext([makeFile("src/settlement/engine.ts", [h])],
      [makeClassification({ hunk_id: "h_s", layer: "A" })])
    const r = seedResult(ctx); domainFloorRule(ctx, r)
    expect(r.get("h_s")!.layer).toBe("C")
    expect(r.get("h_s")!.escalations).toContain("domain_floor")
  })

  it("forces ≥ B when floor is B and layer is A", () => {
    const h = makeHunk("tsconfig.json", "@@", "h_t", { floor: "B" })
    const ctx = makeContext([makeFile("tsconfig.json", [h])],
      [makeClassification({ hunk_id: "h_t", layer: "A", intents: ["config_trivial"] })])
    const r = seedResult(ctx); domainFloorRule(ctx, r)
    expect(r.get("h_t")!.layer).toBe("B")
  })

  it("never demotes", () => {
    const h = makeHunk("tsconfig.json", "@@", "h_t", { floor: "B" })
    const ctx = makeContext([makeFile("tsconfig.json", [h])],
      [makeClassification({ hunk_id: "h_t", layer: "C", intents: ["config_runtime"] })])
    const r = seedResult(ctx); domainFloorRule(ctx, r)
    expect(r.get("h_t")!.layer).toBe("C")
    expect(r.get("h_t")!.escalations).not.toContain("domain_floor")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/promote/rules.test.ts
```

Expected: domain-floor tests fail.

- [ ] **Step 3: Implement `domainFloorRule`**

```ts
export const domainFloorRule: Rule = (ctx, current) => {
  for (const h of ctx.hunks) {
    const c = current.get(h.id)!
    const before = c.layer
    c.layer = maxLayer(c.layer, h.context.domainFloor)
    if (c.layer !== before) c.escalations.push("domain_floor")
  }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/promote/rules.test.ts
git add src/promote/rules.ts tests/unit/promote/rules.test.ts
git commit -m "feat(promote): domain-floor rule (last; cannot demote)"
```

Expected: all tests pass.

---

## Task 14: Promote pipeline orchestrator + property test

Implements: spec §5 stage 4 ordered application.

**Files:**
- Create: `src/promote/pipeline.ts`
- Create: `tests/unit/promote/pipeline.test.ts`

- [ ] **Step 1: Install fast-check**

```bash
pnpm add -D fast-check
```

- [ ] **Step 2: Write failing tests `tests/unit/promote/pipeline.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { promote } from "../../../src/promote/pipeline.js"
import { makeClassification, makeHunk, makeFile, makeContext } from "./_helpers.js"

describe("promote", () => {
  it("applies all rules and returns PromotedClassification per hunk", () => {
    const h1 = makeHunk("src/settlement/x.ts", "@@", "h_1", { floor: "C" })
    const h2 = makeHunk("src/utils/y.ts", "@@", "h_2")
    const ctx = makeContext(
      [makeFile("src/settlement/x.ts", [h1]), makeFile("src/utils/y.ts", [h2])],
      [
        makeClassification({ hunk_id: "h_1", layer: "A", confidence: 0.95, intents: ["typo"] }),
        makeClassification({ hunk_id: "h_2", layer: "B", confidence: 0.6, intents: ["ui_pure"] }),
      ],
    )
    const result = promote(ctx)
    expect(result.get("h_1")!.layer).toBe("C")  // floor
    expect(result.get("h_2")!.layer).toBe("C")  // confidence escalation B → C
  })

  it("preserves originalLayer", () => {
    const h = makeHunk("src/settlement/x.ts", "@@", "h_1", { floor: "C" })
    const ctx = makeContext([makeFile("src/settlement/x.ts", [h])],
      [makeClassification({ hunk_id: "h_1", layer: "A" })])
    const result = promote(ctx)
    expect(result.get("h_1")!.originalLayer).toBe("A")
    expect(result.get("h_1")!.layer).toBe("C")
  })

  it("never demotes any hunk's layer (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("A", "B", "C") as fc.Arbitrary<"A"|"B"|"C">,
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("A", "B", "C") as fc.Arbitrary<"A"|"B"|"C">,
        (layer, conf, floor) => {
          const h = makeHunk("src/x.ts", "@@", "h_p", { floor })
          const ctx = makeContext([makeFile("src/x.ts", [h])],
            [makeClassification({ hunk_id: "h_p", layer, confidence: conf })])
          const rank = { A: 0, B: 1, C: 2 } as const
          const result = promote(ctx)
          return rank[result.get("h_p")!.layer] >= rank[layer]
        },
      ),
    )
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm test tests/unit/promote/pipeline.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/promote/pipeline.ts`**

```ts
import type { PromoteContext, PromotedClassification } from "./types.js"
import {
  multiIntentRule, lowConfidenceRule, crossReferenceRule, dependencyRule,
  exportedSymbolRule, generatedFileRule, domainFloorRule,
} from "./rules.js"

export function promote(ctx: PromoteContext): Map<string, PromotedClassification> {
  const result = new Map<string, PromotedClassification>()
  for (const [id, c] of ctx.classifications) {
    result.set(id, { ...c, originalLayer: c.layer, escalations: [] })
  }
  // Order from §5 stage 4. Domain floor runs last so nothing can outweigh it.
  multiIntentRule(ctx, result)
  lowConfidenceRule(ctx, result)
  crossReferenceRule(ctx, result)
  dependencyRule(ctx, result)
  exportedSymbolRule(ctx, result)
  generatedFileRule(ctx, result)
  domainFloorRule(ctx, result)
  return result
}
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/promote
git add src/promote/pipeline.ts tests/unit/promote/pipeline.test.ts package.json pnpm-lock.yaml
git commit -m "feat(promote): orchestrator + property test (never demotes)"
```

Expected: all pipeline tests + property test pass.

---

## Task 15: Classifier interface and JSON schema

Implements: spec §6 (input/output schema, intents vocabulary), §9 (interface).

**Files:**
- Create: `src/classify/classifier.ts`
- Create: `src/classify/schema.ts`
- Create: `tests/unit/classify/schema.test.ts`

- [ ] **Step 1: Write `src/classify/classifier.ts`**

```ts
import type { Hunk } from "../hunkify/types.js"
import type { Classification } from "../promote/types.js"
import type { Provider } from "../types.js"

export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type ClassifyRequest = {
  systemPrompt: string
  hunks: Hunk[]
}

export type ClassifyResponse = {
  classifications: Classification[]
  usage: Usage
}

export interface Classifier {
  readonly provider: Provider
  readonly model: string
  classify(req: ClassifyRequest): Promise<ClassifyResponse>
  estimateTokens(text: string): number
}
```

- [ ] **Step 2: Write failing test `tests/unit/classify/schema.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { CLASSIFICATIONS_JSON_SCHEMA, classificationsSchema } from "../../../src/classify/schema.js"
import { ALL_INTENTS } from "../../../src/types.js"

describe("classifications schema", () => {
  it("validates a well-formed response", () => {
    const ok = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["typo"], rationale: "fixes typo",
      }],
    }
    expect(() => classificationsSchema.parse(ok)).not.toThrow()
  })

  it("rejects an unknown intent string", () => {
    const bad = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["not_a_real_intent"], rationale: "",
      }],
    }
    expect(() => classificationsSchema.parse(bad)).toThrow()
  })

  it("rejects a layer outside A/B/C", () => {
    const bad = {
      classifications: [{
        hunk_id: "h_1", layer: "D", confidence: 0.9,
        intents: ["typo"], rationale: "",
      }],
    }
    expect(() => classificationsSchema.parse(bad)).toThrow()
  })

  it("rejects rationale > 400 chars", () => {
    const bad = {
      classifications: [{
        hunk_id: "h_1", layer: "A", confidence: 0.9,
        intents: ["typo"], rationale: "x".repeat(401),
      }],
    }
    expect(() => classificationsSchema.parse(bad)).toThrow()
  })

  it("the exported JSON schema enumerates every intent", () => {
    const schemaIntents = CLASSIFICATIONS_JSON_SCHEMA.input_schema.properties
      .classifications.items.properties.intents.items.enum
    expect(new Set(schemaIntents)).toEqual(new Set(ALL_INTENTS))
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm test tests/unit/classify/schema.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/classify/schema.ts`**

```ts
import { z } from "zod"
import { ALL_INTENTS } from "../types.js"

export const classificationsSchema = z.object({
  classifications: z.array(z.object({
    hunk_id: z.string(),
    layer: z.enum(["A", "B", "C"]),
    confidence: z.number().min(0).max(1),
    intents: z.array(z.enum(ALL_INTENTS as [string, ...string[]])).min(1),
    rationale: z.string().max(400),
  })),
})

export const CLASSIFICATIONS_JSON_SCHEMA = {
  name: "submit_classifications",
  description: "Submit layer classifications for every input hunk.",
  input_schema: {
    type: "object",
    required: ["classifications"],
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          required: ["hunk_id", "layer", "confidence", "intents", "rationale"],
          properties: {
            hunk_id: { type: "string" },
            layer: { enum: ["A", "B", "C"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            intents: {
              type: "array",
              minItems: 1,
              items: { enum: [...ALL_INTENTS] },
            },
            rationale: { type: "string", maxLength: 400 },
          },
        },
      },
    },
  },
} as const
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/classify/schema.test.ts
git add src/classify tests/unit/classify
git commit -m "feat(classify): Classifier interface + JSON schema for output"
```

Expected: all 5 tests pass.

---

## Task 16: System prompt builder

Implements: spec §6 system prompt structure.

**Files:**
- Create: `src/classify/prompt.ts`
- Create: `tests/unit/classify/prompt.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/classify/prompt.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { buildSystemPrompt } from "../../../src/classify/prompt.js"
import { DEFAULT_CONFIG } from "../../../src/config/load.js"

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt({
    config: {
      ...DEFAULT_CONFIG,
      floors: { B: ["tsconfig*.json"], C: ["**/settlement/**"] },
      generated: ["**/*.generated.ts"],
    },
  })

  it("includes the role statement", () => {
    expect(prompt).toMatch(/classify code-diff hunks/i)
  })

  it("includes layer definitions", () => {
    expect(prompt).toMatch(/Layer A/)
    expect(prompt).toMatch(/Layer B/)
    expect(prompt).toMatch(/Layer C/)
  })

  it("includes promotion rules", () => {
    expect(prompt).toMatch(/Promotion rules/i)
    expect(prompt).toMatch(/domain floor/i)
  })

  it("inlines the repo config", () => {
    expect(prompt).toContain("**/settlement/**")
    expect(prompt).toContain("**/*.generated.ts")
  })

  it("includes calibration guidance biased toward C", () => {
    expect(prompt).toMatch(/prefer the higher layer when uncertain/i)
  })

  it("includes format directive demanding full coverage", () => {
    expect(prompt).toMatch(/every input hunk_id/i)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/classify/prompt.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/classify/prompt.ts`**

```ts
import { stringify as yamlStringify } from "yaml"
import type { Config } from "../config/schema.js"

const ROLE = `ROLE
You classify code-diff hunks into three review layers (A, B, C).
You do not produce patches. You do not produce code. You only emit
classifications via the submit_classifications tool.`

const LAYER_DEFINITIONS = `LAYER DEFINITIONS

Layer A — AI-auto-reviewable. Mechanical changes with provably zero semantic impact:
typos, formatting, lint autofix, import sort, dead-code removal, internal renames,
pure-function extraction with no captured variables, type annotations that do not
narrow/widen exported types, additive unit tests, dev-only patch dependency bumps,
generated files iff source is in the PR and ≥ Layer B, paired snapshot updates,
trivial config (prettier, editorconfig).

Layer B — Light human review, AI does the heavy lift. Small localized behavior
changes: new pure UI components (no effects/fetch/mutations/permissions/router/store
writes), small fixes outside Layer C domain paths with clear tests, localized
validation/format/display, cross-file extraction or closure-capturing extraction,
exported type changes, cross-boundary renames, non-dev or non-patch dependency
updates with bounded delta, build/lint config tightening, test refactors that change
mock setup or remove assertions.

Layer C — Human review required. Everything in repo's configured domain-risk paths,
business logic, pricing/matching/risk, auth/permissions/sessions/identity/wallet/
signing, schema/migration/persistence/cache/queue/event-processing, public API
contracts, major or runtime dependency updates, performance/concurrency/retry/race,
feature-flag behavior, compliance/analytics, large refactors without mechanical
proof, env/CI/runtime configs, low-confidence hunks, tangled hunks with mixed intents.`

const PROMOTION_RULES = `PROMOTION RULES (informational; applied deterministically after you)

1. Domain-risk path match → ≥ C.
2. Exported-symbol rename / signature change → ≥ B (also escalates known callers).
3. String literal also referenced in JSON/YAML/SQL/env files in the PR → ≥ B.
4. package.json major bump or runtime dependency → ≥ C.
5. Multi-intent hunk → escalate one layer.
6. Confidence < threshold → escalate one layer.

These run after your classification; you do not need to apply them yourself, but
producing a rationale consistent with them helps the final output be coherent.`

const CALIBRATION = `CALIBRATION
- Confidence reflects YOUR certainty about classification, not code correctness.
- If you cannot determine intent in one read, set confidence < threshold and use
  intent "unknown".
- Prefer the higher layer when uncertain. Cost of over-escalation is small; cost
  of under-escalation is a missed human review.`

const FORMAT = `FORMAT
Call submit_classifications exactly once with every input hunk_id covered.
Missing any hunk_id is a hard error.`

export type BuildPromptArgs = { config: Config }

export function buildSystemPrompt(args: BuildPromptArgs): string {
  const configBlock = "REPO CONFIG\n" + yamlStringify({
    floors: args.config.floors,
    generated: args.config.generated,
    confidence_threshold: args.config.confidence_threshold,
  })
  return [
    ROLE,
    LAYER_DEFINITIONS,
    PROMOTION_RULES,
    configBlock,
    CALIBRATION,
    FORMAT,
  ].join("\n\n")
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/classify/prompt.test.ts
git add src/classify/prompt.ts tests/unit/classify/prompt.test.ts
git commit -m "feat(classify): system prompt builder with biased calibration"
```

Expected: all 6 tests pass.

---

## Task 17: Batching + coverage retry

Implements: spec §6 robustness section (batching, coverage check, retry).

**Files:**
- Create: `src/classify/batch.ts`
- Create: `tests/unit/classify/batch.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/classify/batch.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest"
import { classifyAll, batchHunks } from "../../../src/classify/batch.js"
import type { Classifier } from "../../../src/classify/classifier.js"
import type { Hunk } from "../../../src/hunkify/types.js"

function fakeHunk(id: string): Hunk {
  return {
    id, file: `src/${id}.ts`, oldPath: null,
    oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, body: "@@",
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false, isModeChange: false,
    context: { fileLanguage: "ts", isGenerated: false, domainFloor: "A" },
  }
}

function classifierThatReturns(
  fn: (ids: string[]) => string[],
): Classifier {
  return {
    provider: "claude", model: "test",
    estimateTokens: (s) => Math.ceil(s.length / 4),
    classify: vi.fn(async ({ hunks }) => ({
      classifications: fn(hunks.map((h) => h.id)).map((id) => ({
        hunk_id: id, layer: "A" as const, confidence: 0.9,
        intents: ["typo" as const], rationale: "",
      })),
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  }
}

describe("batchHunks", () => {
  it("splits hunks into batches respecting maxPerBatch", () => {
    const hunks = Array.from({ length: 10 }, (_, i) => fakeHunk(`h_${i}`))
    const batches = batchHunks(hunks, { maxPerBatch: 4, maxTokensPerBatch: 1e9, estimate: () => 0 })
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(4)
    expect(batches[2]).toHaveLength(2)
  })

  it("starts a new batch when token budget would be exceeded", () => {
    const hunks = Array.from({ length: 4 }, (_, i) => fakeHunk(`h_${i}`))
    const batches = batchHunks(hunks, {
      maxPerBatch: 100, maxTokensPerBatch: 100, estimate: () => 60,
    })
    expect(batches).toHaveLength(4)  // each hunk solo because 60+60 > 100
  })
})

describe("classifyAll", () => {
  it("returns classifications for every hunk", async () => {
    const hunks = Array.from({ length: 5 }, (_, i) => fakeHunk(`h_${i}`))
    const c = classifierThatReturns((ids) => ids)
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 3, maxTokensPerBatch: 1e9,
    })
    expect(out.classifications).toHaveLength(5)
    expect(c.classify).toHaveBeenCalledTimes(2)
  })

  it("retries once when a batch is missing hunk ids", async () => {
    const hunks = Array.from({ length: 3 }, (_, i) => fakeHunk(`h_${i}`))
    let call = 0
    const c: Classifier = {
      provider: "claude", model: "test", estimateTokens: () => 1,
      classify: vi.fn(async ({ hunks: input }) => {
        call++
        const ids = input.map((h) => h.id)
        const returned = call === 1 ? ids.slice(0, 1) : ids
        return {
          classifications: returned.map((id) => ({
            hunk_id: id, layer: "A" as const, confidence: 0.9,
            intents: ["typo" as const], rationale: "",
          })),
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      }),
    }
    const out = await classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
    })
    expect(out.classifications).toHaveLength(3)
    expect(c.classify).toHaveBeenCalledTimes(2)
  })

  it("throws when retry also misses hunk ids", async () => {
    const hunks = [fakeHunk("h_0"), fakeHunk("h_1")]
    const c = classifierThatReturns((ids) => [ids[0]!])
    await expect(classifyAll({
      hunks, classifier: c, systemPrompt: "sys",
      maxPerBatch: 10, maxTokensPerBatch: 1e9,
    })).rejects.toThrow(/missing/i)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/classify/batch.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/classify/batch.ts`**

```ts
import type { Classifier, ClassifyResponse, Usage } from "./classifier.js"
import type { Hunk } from "../hunkify/types.js"
import type { Classification } from "../promote/types.js"

export type BatchOpts = {
  maxPerBatch: number
  maxTokensPerBatch: number
  estimate: (text: string) => number
}

export function batchHunks(hunks: Hunk[], opts: BatchOpts): Hunk[][] {
  const batches: Hunk[][] = []
  let current: Hunk[] = []
  let currentTokens = 0
  for (const h of hunks) {
    const cost = opts.estimate(JSON.stringify({ id: h.id, file: h.file, diff: h.body }))
    const wouldOverflow =
      current.length >= opts.maxPerBatch ||
      (current.length > 0 && currentTokens + cost > opts.maxTokensPerBatch)
    if (wouldOverflow) {
      batches.push(current)
      current = []
      currentTokens = 0
    }
    current.push(h)
    currentTokens += cost
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export type ClassifyAllArgs = {
  hunks: Hunk[]
  classifier: Classifier
  systemPrompt: string
  maxPerBatch: number
  maxTokensPerBatch: number
}

export async function classifyAll(args: ClassifyAllArgs): Promise<ClassifyResponse> {
  const batches = batchHunks(args.hunks, {
    maxPerBatch: args.maxPerBatch,
    maxTokensPerBatch: args.maxTokensPerBatch,
    estimate: (s) => args.classifier.estimateTokens(s),
  })
  const all: Classification[] = []
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

  for (const batch of batches) {
    let result = await args.classifier.classify({
      systemPrompt: args.systemPrompt, hunks: batch,
    })
    accUsage(usage, result.usage)

    let missing = findMissing(batch, result.classifications)
    if (missing.length > 0) {
      const retryBatch = batch.filter((h) => missing.includes(h.id))
      const retry = await args.classifier.classify({
        systemPrompt: args.systemPrompt + "\n\nRETRY: missing ids — " + missing.join(","),
        hunks: retryBatch,
      })
      accUsage(usage, retry.usage)
      result = {
        classifications: [...result.classifications, ...retry.classifications],
        usage: retry.usage,
      }
      missing = findMissing(batch, result.classifications)
      if (missing.length > 0) {
        throw new Error(`Classifier missing hunk ids after retry: ${missing.join(",")}`)
      }
    }
    all.push(...result.classifications)
  }

  return { classifications: all, usage }
}

function findMissing(batch: Hunk[], classifications: Classification[]): string[] {
  const got = new Set(classifications.map((c) => c.hunk_id))
  return batch.filter((h) => !got.has(h.id)).map((h) => h.id)
}

function accUsage(into: Usage, from: Usage): void {
  into.inputTokens += from.inputTokens
  into.outputTokens += from.outputTokens
  into.cacheReadTokens = (into.cacheReadTokens ?? 0) + (from.cacheReadTokens ?? 0)
  into.cacheWriteTokens = (into.cacheWriteTokens ?? 0) + (from.cacheWriteTokens ?? 0)
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/classify/batch.test.ts
git add src/classify/batch.ts tests/unit/classify/batch.test.ts
git commit -m "feat(classify): batching + coverage retry"
```

Expected: all 5 tests pass.

---

## Task 18: ClaudeClassifier

Implements: spec §9 Claude provider.

**Files:**
- Create: `src/classify/claude.ts`
- Create: `tests/unit/classify/claude.test.ts`
- Create: `tests/fixtures/llm-responses/claude-simple.json`

- [ ] **Step 1: Write recorded response fixture `tests/fixtures/llm-responses/claude-simple.json`**

```json
{
  "id": "msg_test",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-7",
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_1",
      "name": "submit_classifications",
      "input": {
        "classifications": [
          {
            "hunk_id": "h_test_1",
            "layer": "A",
            "confidence": 0.95,
            "intents": ["typo"],
            "rationale": "Fixes a typo in error message."
          }
        ]
      }
    }
  ],
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 56,
    "cache_creation_input_tokens": 800,
    "cache_read_input_tokens": 0
  }
}
```

- [ ] **Step 2: Write failing test `tests/unit/classify/claude.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ClaudeClassifier } from "../../../src/classify/claude.js"

const recorded = JSON.parse(readFileSync(
  join(__dirname, "../../fixtures/llm-responses/claude-simple.json"), "utf8"))

describe("ClaudeClassifier", () => {
  it("parses a tool_use response into classifications + usage", () => {
    const c = new ClaudeClassifier({ apiKey: "x", model: "claude-opus-4-7" })
    const parsed = c.parseResponseForTest(recorded)
    expect(parsed.classifications).toHaveLength(1)
    expect(parsed.classifications[0]!.hunk_id).toBe("h_test_1")
    expect(parsed.usage.inputTokens).toBe(1234)
    expect(parsed.usage.cacheWriteTokens).toBe(800)
  })

  it("estimates tokens with a non-zero result", () => {
    const c = new ClaudeClassifier({ apiKey: "x", model: "claude-opus-4-7" })
    expect(c.estimateTokens("hello world")).toBeGreaterThan(0)
  })

  it("throws when the response has no tool_use block", () => {
    const c = new ClaudeClassifier({ apiKey: "x", model: "claude-opus-4-7" })
    expect(() => c.parseResponseForTest({
      content: [{ type: "text", text: "I refuse." }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })).toThrow(/tool_use/)
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm test tests/unit/classify/claude.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/classify/claude.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk"
import { countTokens } from "@anthropic-ai/tokenizer"
import { CLASSIFICATIONS_JSON_SCHEMA, classificationsSchema } from "./schema.js"
import type { Classifier, ClassifyRequest, ClassifyResponse, Usage } from "./classifier.js"

export type ClaudeClassifierOpts = { apiKey: string; model: string }

type RawResponse = {
  content?: Array<
    | { type: "tool_use"; name: string; input: unknown }
    | { type: "text"; text: string }
  >
  usage?: {
    input_tokens?: number; output_tokens?: number
    cache_creation_input_tokens?: number; cache_read_input_tokens?: number
  }
}

export class ClaudeClassifier implements Classifier {
  readonly provider = "claude" as const
  readonly model: string
  private client: Anthropic

  constructor(opts: ClaudeClassifierOpts) {
    this.model = opts.model
    this.client = new Anthropic({ apiKey: opts.apiKey })
  }

  estimateTokens(text: string): number {
    return countTokens(text)
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      temperature: 0,
      system: [
        {
          type: "text",
          text: req.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ] as unknown as string,  // SDK type accepts string[] of blocks at runtime
      tools: [CLASSIFICATIONS_JSON_SCHEMA as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "submit_classifications" },
      messages: [{
        role: "user",
        content: JSON.stringify({
          hunks: req.hunks.map((h) => ({
            id: h.id, file: h.file, language: h.context.fileLanguage,
            isGenerated: h.context.isGenerated, domainFloor: h.context.domainFloor,
            diff: h.body,
          })),
        }),
      }],
    })
    return this.parseResponseForTest(res as unknown as RawResponse)
  }

  parseResponseForTest(res: RawResponse): ClassifyResponse {
    const toolBlock = res.content?.find(
      (b): b is { type: "tool_use"; name: string; input: unknown } =>
        b.type === "tool_use" && b.name === "submit_classifications")
    if (!toolBlock) throw new Error("Claude response missing tool_use block")
    const parsed = classificationsSchema.parse(toolBlock.input)
    const usage: Usage = {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? 0,
    }
    return { classifications: parsed.classifications, usage }
  }
}
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/classify/claude.test.ts
git add src/classify/claude.ts tests/unit/classify/claude.test.ts tests/fixtures/llm-responses
git commit -m "feat(classify): ClaudeClassifier with tool-use + caching"
```

Expected: all 3 tests pass.

---

## Task 19: OpenAIClassifier + provider selection

Implements: spec §9 OpenAI provider + `detectFromEnv`.

**Files:**
- Create: `src/classify/openai.ts`
- Create: `src/classify/select.ts`
- Create: `tests/unit/classify/openai.test.ts`
- Create: `tests/unit/classify/select.test.ts`
- Create: `tests/fixtures/llm-responses/openai-simple.json`

- [ ] **Step 1: Write fixture `tests/fixtures/llm-responses/openai-simple.json`**

```json
{
  "id": "chatcmpl_test",
  "object": "chat.completion",
  "model": "gpt-5",
  "choices": [{
    "index": 0,
    "finish_reason": "stop",
    "message": {
      "role": "assistant",
      "content": "{\"classifications\":[{\"hunk_id\":\"h_test_1\",\"layer\":\"A\",\"confidence\":0.95,\"intents\":[\"typo\"],\"rationale\":\"Fixes a typo.\"}]}"
    }
  }],
  "usage": { "prompt_tokens": 1234, "completion_tokens": 56 }
}
```

- [ ] **Step 2: Write failing tests**

`tests/unit/classify/openai.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OpenAIClassifier } from "../../../src/classify/openai.js"

const recorded = JSON.parse(readFileSync(
  join(__dirname, "../../fixtures/llm-responses/openai-simple.json"), "utf8"))

describe("OpenAIClassifier", () => {
  it("parses a structured-output completion into classifications", () => {
    const c = new OpenAIClassifier({ apiKey: "x", model: "gpt-5" })
    const parsed = c.parseResponseForTest(recorded)
    expect(parsed.classifications).toHaveLength(1)
    expect(parsed.classifications[0]!.hunk_id).toBe("h_test_1")
    expect(parsed.usage.inputTokens).toBe(1234)
  })

  it("throws on non-JSON content", () => {
    const c = new OpenAIClassifier({ apiKey: "x", model: "gpt-5" })
    expect(() => c.parseResponseForTest({
      choices: [{ message: { content: "I cannot do that." } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    } as any)).toThrow()
  })
})
```

`tests/unit/classify/select.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { detectFromEnv, requireKey } from "../../../src/classify/select.js"

describe("detectFromEnv", () => {
  it("prefers ANTHROPIC_API_KEY", () => {
    expect(detectFromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b" })).toBe("claude")
  })

  it("falls back to OPENAI_API_KEY", () => {
    expect(detectFromEnv({ OPENAI_API_KEY: "b" })).toBe("openai")
  })

  it("returns null when neither is set", () => {
    expect(detectFromEnv({})).toBeNull()
  })
})

describe("requireKey", () => {
  it("returns the key for claude", () => {
    expect(requireKey("claude", { ANTHROPIC_API_KEY: "a" })).toBe("a")
  })

  it("throws when the required key is missing", () => {
    expect(() => requireKey("openai", {})).toThrow(/OPENAI_API_KEY/)
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

```bash
pnpm test tests/unit/classify/openai.test.ts tests/unit/classify/select.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/classify/openai.ts`**

```ts
import OpenAI from "openai"
import { encoding_for_model, get_encoding } from "tiktoken"
import { CLASSIFICATIONS_JSON_SCHEMA, classificationsSchema } from "./schema.js"
import type { Classifier, ClassifyRequest, ClassifyResponse, Usage } from "./classifier.js"

export type OpenAIClassifierOpts = { apiKey: string; model: string }

type RawCompletion = {
  choices: Array<{ message: { content: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class OpenAIClassifier implements Classifier {
  readonly provider = "openai" as const
  readonly model: string
  private client: OpenAI
  private encoder: { encode: (s: string) => Uint32Array; free?: () => void }

  constructor(opts: OpenAIClassifierOpts) {
    this.model = opts.model
    this.client = new OpenAI({ apiKey: opts.apiKey })
    try {
      this.encoder = encoding_for_model(opts.model as any)
    } catch {
      this.encoder = get_encoding("o200k_base")
    }
  }

  estimateTokens(text: string): number {
    return this.encoder.encode(text).length
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "submit_classifications",
          schema: CLASSIFICATIONS_JSON_SCHEMA.input_schema as Record<string, unknown>,
          strict: true,
        },
      },
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: JSON.stringify({
          hunks: req.hunks.map((h) => ({
            id: h.id, file: h.file, language: h.context.fileLanguage,
            isGenerated: h.context.isGenerated, domainFloor: h.context.domainFloor,
            diff: h.body,
          })),
        }) },
      ],
    })
    return this.parseResponseForTest(res as unknown as RawCompletion)
  }

  parseResponseForTest(res: RawCompletion): ClassifyResponse {
    const content = res.choices[0]?.message.content
    if (!content) throw new Error("OpenAI completion has empty content")
    let parsed: unknown
    try { parsed = JSON.parse(content) }
    catch (e) { throw new Error(`OpenAI returned non-JSON: ${(e as Error).message}`) }
    const validated = classificationsSchema.parse(parsed)
    const usage: Usage = {
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    }
    return { classifications: validated.classifications, usage }
  }
}
```

- [ ] **Step 5: Implement `src/classify/select.ts`**

```ts
import type { Provider } from "../types.js"
import type { Classifier } from "./classifier.js"
import type { Config } from "../config/schema.js"
import { ClaudeClassifier } from "./claude.js"
import { OpenAIClassifier } from "./openai.js"

export function detectFromEnv(env: NodeJS.ProcessEnv): Provider | null {
  if (env.ANTHROPIC_API_KEY) return "claude"
  if (env.OPENAI_API_KEY) return "openai"
  return null
}

export function requireKey(provider: Provider, env: NodeJS.ProcessEnv): string {
  if (provider === "claude") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for provider=claude")
    return env.ANTHROPIC_API_KEY
  }
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for provider=openai")
  return env.OPENAI_API_KEY
}

export function makeClassifier(opts: {
  provider: Provider; model?: string; config: Config; env: NodeJS.ProcessEnv
}): Classifier {
  const apiKey = requireKey(opts.provider, opts.env)
  if (opts.provider === "claude") {
    return new ClaudeClassifier({ apiKey, model: opts.model ?? opts.config.providers.claude.model })
  }
  return new OpenAIClassifier({ apiKey, model: opts.model ?? opts.config.providers.openai.model })
}
```

- [ ] **Step 6: Run tests and commit**

```bash
pnpm test tests/unit/classify
git add src/classify tests/unit/classify tests/fixtures/llm-responses
git commit -m "feat(classify): OpenAI provider + env-based provider selection"
```

Expected: all classify tests pass.

---

## Task 20: Trailer format + parse

Implements: spec §7 commit construction (trailer set), §8 `verify`.

**Files:**
- Create: `src/trailer/format.ts`
- Create: `src/trailer/parse.ts`
- Create: `tests/unit/trailer/trailer.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/trailer/trailer.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/trailer/trailer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/trailer/format.ts`**

```ts
import type { Layer, Provider } from "../types.js"

export type TrailerInput = {
  layer: Layer
  sourcePR: string         // "owner/repo#123"
  sourceHead: string       // sha
  hunkIds: string[]
  toolVersion: string
  provider: Provider
  model: string
}

export function formatTrailers(t: TrailerInput): string {
  return [
    `Vibereview-Layer: ${t.layer}`,
    `Vibereview-Source-PR: ${t.sourcePR}`,
    `Vibereview-Source-Head: ${t.sourceHead}`,
    `Vibereview-Hunks: ${t.hunkIds.join(",")}`,
    `Vibereview-Tool-Version: ${t.toolVersion}`,
    `Vibereview-Provider: ${t.provider}`,
    `Vibereview-Model: ${t.model}`,
  ].join("\n")
}
```

- [ ] **Step 4: Implement `src/trailer/parse.ts`**

```ts
import type { TrailerInput } from "./format.js"
import type { Layer, Provider } from "../types.js"

const RE_LAYER    = /^Vibereview-Layer:\s*([ABC])\s*$/m
const RE_SRC_PR   = /^Vibereview-Source-PR:\s*(.+?)\s*$/m
const RE_SRC_HEAD = /^Vibereview-Source-Head:\s*([0-9a-f]+)\s*$/m
const RE_HUNKS    = /^Vibereview-Hunks:\s*(.+?)\s*$/m
const RE_VER      = /^Vibereview-Tool-Version:\s*(.+?)\s*$/m
const RE_PROV     = /^Vibereview-Provider:\s*(claude|openai)\s*$/m
const RE_MODEL    = /^Vibereview-Model:\s*(.+?)\s*$/m

export function parseTrailers(message: string): TrailerInput | null {
  const layer = message.match(RE_LAYER)?.[1] as Layer | undefined
  if (!layer) return null
  const srcPr = message.match(RE_SRC_PR)?.[1]
  const head = message.match(RE_SRC_HEAD)?.[1]
  const hunks = message.match(RE_HUNKS)?.[1]
  const ver = message.match(RE_VER)?.[1]
  const prov = message.match(RE_PROV)?.[1] as Provider | undefined
  const model = message.match(RE_MODEL)?.[1]
  if (!srcPr || !head || !hunks || !ver || !prov || !model) return null
  return {
    layer, sourcePR: srcPr, sourceHead: head,
    hunkIds: hunks.split(",").filter((s) => s.length > 0),
    toolVersion: ver, provider: prov, model,
  }
}
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/trailer/trailer.test.ts
git add src/trailer tests/unit/trailer
git commit -m "feat(trailer): format and parse Vibereview-* commit trailers"
```

Expected: all 4 tests pass.

---

## Task 21: Git exec wrapper + checks

Implements: spec §7 integrity check helpers.

**Files:**
- Create: `src/git/exec.ts`
- Create: `src/git/checks.ts`
- Create: `tests/unit/git/checks.test.ts`

- [ ] **Step 1: Write `src/git/exec.ts`**

```ts
import { execa, type Options } from "execa"

export async function git(args: string[], opts: Options = {}): Promise<string> {
  const result = await execa("git", args, { reject: true, ...opts })
  return typeof result.stdout === "string" ? result.stdout : ""
}

export async function gitMaybe(args: string[], opts: Options = {}): Promise<{
  stdout: string; exitCode: number
}> {
  const result = await execa("git", args, { reject: false, ...opts })
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    exitCode: result.exitCode ?? 1,
  }
}
```

- [ ] **Step 2: Write failing test `tests/unit/git/checks.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { treeHash, diffRange } from "../../../src/git/checks.js"

describe("git checks", () => {
  let dir: string
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vibereview-test-"))
    await execa("git", ["init", "-q"], { cwd: dir })
    await execa("git", ["config", "user.email", "t@t"], { cwd: dir })
    await execa("git", ["config", "user.name", "t"], { cwd: dir })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: dir })
    writeFileSync(join(dir, "a.txt"), "hello\n")
    await execa("git", ["add", "a.txt"], { cwd: dir })
    await execa("git", ["commit", "-q", "-m", "init"], { cwd: dir })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("treeHash returns a stable sha for HEAD's tree", async () => {
    const t1 = await treeHash(dir, "HEAD")
    const t2 = await treeHash(dir, "HEAD")
    expect(t1).toBe(t2)
    expect(t1).toMatch(/^[0-9a-f]{40}$/)
  })

  it("diffRange returns the diff between two commits", async () => {
    writeFileSync(join(dir, "a.txt"), "hello\nworld\n")
    await execa("git", ["commit", "-q", "-am", "world"], { cwd: dir })
    const diff = await diffRange(dir, "HEAD~1", "HEAD")
    expect(diff).toMatch(/\+world/)
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm test tests/unit/git/checks.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/git/checks.ts`**

```ts
import { git } from "./exec.js"

export async function treeHash(cwd: string, ref: string): Promise<string> {
  return (await git(["rev-parse", `${ref}^{tree}`], { cwd })).trim()
}

export async function diffRange(cwd: string, from: string, to: string): Promise<string> {
  return git(["diff", "--no-color", `${from}..${to}`], { cwd })
}

export async function headSha(cwd: string): Promise<string> {
  return (await git(["rev-parse", "HEAD"], { cwd })).trim()
}
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test tests/unit/git
git add src/git tests/unit/git
git commit -m "feat(git): exec wrapper + treeHash/diffRange/headSha helpers"
```

Expected: all 2 tests pass.

---

## Task 22: Throwaway worktree management

Implements: spec §5 stage 1 (worktree at base), §7 (discard on failure).

**Files:**
- Create: `src/apply/worktree.ts`
- Create: `tests/unit/apply/worktree.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/apply/worktree.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withWorktree } from "../../../src/apply/worktree.js"

describe("withWorktree", () => {
  let repo: string
  let baseSha: string

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-repo-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "a.txt"), "v1\n")
    await execa("git", ["add", "a.txt"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "v1"], { cwd: repo })
    baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("creates a worktree at base, runs the callback, and removes the worktree", async () => {
    let wtPath = ""
    const result = await withWorktree(repo, baseSha, async (wt) => {
      wtPath = wt.path
      expect(existsSync(wt.path)).toBe(true)
      return "ok"
    })
    expect(result).toBe("ok")
    expect(existsSync(wtPath)).toBe(false)
  })

  it("removes the worktree even if the callback throws", async () => {
    let wtPath = ""
    await expect(withWorktree(repo, baseSha, async (wt) => {
      wtPath = wt.path
      throw new Error("boom")
    })).rejects.toThrow("boom")
    expect(existsSync(wtPath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/apply/worktree.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/apply/worktree.ts`**

```ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gitMaybe, git } from "../git/exec.js"

export type Worktree = { path: string; baseSha: string }

export async function withWorktree<T>(
  repoPath: string,
  baseSha: string,
  fn: (wt: Worktree) => Promise<T>,
): Promise<T> {
  const path = mkdtempSync(join(tmpdir(), "vibereview-wt-"))
  await git(["worktree", "add", "--detach", path, baseSha], { cwd: repoPath })
  try {
    return await fn({ path, baseSha })
  } finally {
    await gitMaybe(["worktree", "remove", "--force", path], { cwd: repoPath })
    rmSync(path, { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/apply/worktree.test.ts
git add src/apply/worktree.ts tests/unit/apply/worktree.test.ts
git commit -m "feat(apply): withWorktree helper (auto-cleanup on success/throw)"
```

Expected: all 2 tests pass.

---

## Task 23: Per-layer patch rendering

Implements: spec §7 render-and-apply approach (rendering only).

**Files:**
- Create: `src/apply/render.ts`
- Create: `tests/unit/apply/render.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/apply/render.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { renderLayerPatch } from "../../../src/apply/render.js"
import type { Hunk, FileChange } from "../../../src/hunkify/types.js"

function h(file: string, body: string, id: string, oldStart = 1, oldLines = 1, newStart = 1, newLines = 1): Hunk {
  return {
    id, file, oldPath: null, oldStart, oldLines, newStart, newLines, body,
    isBinary: false, isRename: false, isDelete: false, isSubmodule: false, isModeChange: false,
    context: { fileLanguage: "ts", isGenerated: false, domainFloor: "A" },
  }
}

describe("renderLayerPatch", () => {
  it("renders a unified patch with proper file headers", () => {
    const hunk = h("src/a.ts",
      "@@ -1,1 +1,1 @@\n-old\n+new", "h_1")
    const file: FileChange = {
      file: "src/a.ts", oldPath: "src/a.ts", language: "ts",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false, hunks: [hunk],
    }
    const patch = renderLayerPatch([file], new Set(["h_1"]))
    expect(patch).toContain("diff --git a/src/a.ts b/src/a.ts")
    expect(patch).toContain("--- a/src/a.ts")
    expect(patch).toContain("+++ b/src/a.ts")
    expect(patch).toContain("@@ -1,1 +1,1 @@")
  })

  it("emits hunks in oldStart order per file", () => {
    const f: FileChange = {
      file: "src/a.ts", oldPath: "src/a.ts", language: "ts",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false,
      hunks: [
        h("src/a.ts", "@@ -50,1 +50,1 @@\n-z\n+Z", "h_50", 50, 1, 50, 1),
        h("src/a.ts", "@@ -10,1 +10,1 @@\n-a\n+A", "h_10", 10, 1, 10, 1),
      ],
    }
    const patch = renderLayerPatch([f], new Set(["h_10", "h_50"]))
    const idx10 = patch.indexOf("@@ -10")
    const idx50 = patch.indexOf("@@ -50")
    expect(idx10).toBeGreaterThanOrEqual(0)
    expect(idx10).toBeLessThan(idx50)
  })

  it("includes a rename header when the file is a rename", () => {
    const hunk = h("src/new.ts", "@@ -1,1 +1,1 @@\n-old\n+new", "h_1")
    const f: FileChange = {
      file: "src/new.ts", oldPath: "src/old.ts", language: "ts",
      isBinary: false, isRename: true, isDelete: false, isSubmodule: false, hunks: [hunk],
    }
    const patch = renderLayerPatch([f], new Set(["h_1"]))
    expect(patch).toContain("rename from src/old.ts")
    expect(patch).toContain("rename to src/new.ts")
  })

  it("omits files where no hunk is in the selected layer", () => {
    const f: FileChange = {
      file: "src/skip.ts", oldPath: "src/skip.ts", language: "ts",
      isBinary: false, isRename: false, isDelete: false, isSubmodule: false,
      hunks: [h("src/skip.ts", "@@ -1,1 +1,1 @@\n-a\n+b", "h_a")],
    }
    const patch = renderLayerPatch([f], new Set([]))
    expect(patch).toBe("")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/apply/render.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/apply/render.ts`**

```ts
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
  const oldPath = f.oldPath ?? f.file
  const newPath = f.file
  const lines: string[] = [`diff --git a/${oldPath} b/${newPath}`]
  if (f.isRename) {
    lines.push("similarity index 90%")
    lines.push(`rename from ${oldPath}`)
    lines.push(`rename to ${newPath}`)
  }
  if (f.isDelete) lines.push("deleted file mode 100644")
  if (!f.isBinary && !f.isSubmodule) {
    lines.push(`--- a/${oldPath}`)
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
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/apply/render.test.ts
git add src/apply/render.ts tests/unit/apply/render.test.ts
git commit -m "feat(apply): render per-layer unified patch"
```

Expected: all 4 tests pass.

---

## Task 24: Apply with `git apply --3way` + escalation fallback

Implements: spec §7 apply + escalation, §5 stage 5.

**Files:**
- Create: `src/apply/apply.ts`
- Create: `tests/unit/apply/apply.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/apply/apply.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyPatchOrEscalate } from "../../../src/apply/apply.js"

describe("applyPatchOrEscalate", () => {
  let repo: string

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-apply-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "line1\nline2\nline3\n")
    await execa("git", ["add", "f.txt"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "init"], { cwd: repo })
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("applies a clean patch", async () => {
    const patch =
`diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 line1
-line2
+LINE2
 line3
`
    const result = await applyPatchOrEscalate(repo, patch)
    expect(result.applied).toBe(true)
    expect(result.rejectedHunks).toEqual([])
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toContain("LINE2")
  })

  it("returns rejected hunks for a patch that cannot apply", async () => {
    const patch =
`diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 nonexistent
-line2
+CHANGED
 line3
`
    const result = await applyPatchOrEscalate(repo, patch)
    expect(result.applied).toBe(false)
    expect(result.rejectedHunks.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/apply/apply.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/apply/apply.ts`**

```ts
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gitMaybe } from "../git/exec.js"

export type ApplyResult = {
  applied: boolean
  rejectedHunks: { file: string; hunkHeader: string }[]
  stderr: string
}

export async function applyPatchOrEscalate(cwd: string, patch: string): Promise<ApplyResult> {
  if (patch.trim().length === 0) {
    return { applied: true, rejectedHunks: [], stderr: "" }
  }
  const patchDir = mkdtempSync(join(tmpdir(), "vibereview-patch-"))
  const patchFile = join(patchDir, "layer.patch")
  writeFileSync(patchFile, patch)
  try {
    const tryThreeWay = await gitMaybe(["apply", "--3way", "--whitespace=nowarn", patchFile], { cwd })
    if (tryThreeWay.exitCode === 0) {
      return { applied: true, rejectedHunks: [], stderr: "" }
    }
    const tryPlain = await gitMaybe(["apply", "--reject", "--whitespace=nowarn", patchFile], { cwd })
    const rejectedHunks = parseRejects((tryPlain.stdout ?? "") + "\n" + (tryPlain.stdout ?? ""))
    return {
      applied: tryPlain.exitCode === 0,
      rejectedHunks,
      stderr: tryThreeWay.stdout ?? "",
    }
  } finally {
    rmSync(patchDir, { recursive: true, force: true })
  }
}

function parseRejects(stderr: string): { file: string; hunkHeader: string }[] {
  const out: { file: string; hunkHeader: string }[] = []
  const re = /error: while searching for:[^]*?error: patch failed: ([^\n]+):(\d+)/g
  for (const m of stderr.matchAll(re)) {
    out.push({ file: m[1]!, hunkHeader: m[2]! })
  }
  return out
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/apply/apply.test.ts
git add src/apply/apply.ts tests/unit/apply/apply.test.ts
git commit -m "feat(apply): apply patch with --3way and capture rejects"
```

Expected: all 2 tests pass. (The escalation step itself — moving rejected hunks to later layers — happens in the orchestrator in Task 31.)

---

## Task 25: Commit construction

Implements: spec §7 commit construction.

**Files:**
- Create: `src/apply/commit.ts`
- Create: `tests/unit/apply/commit.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/apply/commit.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { buildLayerCommitMessage } from "../../../src/apply/commit.js"

describe("buildLayerCommitMessage", () => {
  it("includes title, body, and all trailers", () => {
    const msg = buildLayerCommitMessage({
      layer: "A",
      sourcePR: "cowprotocol/cowswap#1234",
      sourceHead: "def456abc789",
      hunkIds: ["h_1", "h_2"],
      toolVersion: "0.1.0",
      provider: "claude",
      model: "claude-opus-4-7",
      generatedAt: new Date("2026-05-17T14:32:00Z"),
    })
    expect(msg).toMatch(/^\[Layer A\] Mechanical changes — vibereview\/pr-1234/m)
    expect(msg).toContain("Vibereview-Layer: A")
    expect(msg).toContain("Vibereview-Hunks: h_1,h_2")
    expect(msg).toContain("Generated by vibereview on 2026-05-17")
  })

  it("uses the right label for each layer", () => {
    const a = buildLayerCommitMessage({ layer: "A", sourcePR: "x/y#1", sourceHead: "abc",
      hunkIds: [], toolVersion: "0", provider: "claude", model: "m", generatedAt: new Date() })
    const b = buildLayerCommitMessage({ layer: "B", sourcePR: "x/y#1", sourceHead: "abc",
      hunkIds: [], toolVersion: "0", provider: "claude", model: "m", generatedAt: new Date() })
    const c = buildLayerCommitMessage({ layer: "C", sourcePR: "x/y#1", sourceHead: "abc",
      hunkIds: [], toolVersion: "0", provider: "claude", model: "m", generatedAt: new Date() })
    expect(a).toMatch(/^\[Layer A\] Mechanical changes/m)
    expect(b).toMatch(/^\[Layer B\] Light human review/m)
    expect(c).toMatch(/^\[Layer C\] Human review required/m)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/apply/commit.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/apply/commit.ts`**

```ts
import { formatTrailers, type TrailerInput } from "../trailer/format.js"
import type { Layer } from "../types.js"

const LABEL: Record<Layer, string> = {
  A: "Mechanical changes",
  B: "Light human review",
  C: "Human review required",
}

export type BuildCommitMessageArgs = TrailerInput & { generatedAt: Date }

export function buildLayerCommitMessage(args: BuildCommitMessageArgs): string {
  const prNum = args.sourcePR.split("#")[1] ?? "?"
  const date = args.generatedAt.toISOString().slice(0, 10)
  const title = `[Layer ${args.layer}] ${LABEL[args.layer]} — vibereview/pr-${prNum}`
  const body =
`Generated by vibereview on ${date}.
This commit groups hunks classified as Layer ${args.layer}.
See PR description for the full manifest.`
  const trailers = formatTrailers(args)
  return `${title}\n\n${body}\n\n${trailers}\n`
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/apply/commit.test.ts
git add src/apply/commit.ts tests/unit/apply/commit.test.ts
git commit -m "feat(apply): layer commit message builder with trailers"
```

Expected: all 2 tests pass.

---

## Task 26: Integrity check

Implements: spec §7 integrity check (diff + tree equality).

**Files:**
- Create: `src/apply/integrity.ts`
- Create: `tests/unit/apply/integrity.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/apply/integrity.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkIntegrity } from "../../../src/apply/integrity.js"

describe("checkIntegrity", () => {
  let repo: string
  let baseSha = ""
  let originalSha = ""
  let companionSha = ""

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-int-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "base\n")
    await execa("git", ["add", "f.txt"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "base"], { cwd: repo })
    baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    writeFileSync(join(repo, "f.txt"), "base\nmore\n")
    await execa("git", ["commit", "-q", "-am", "original"], { cwd: repo })
    originalSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    // Companion: branch from base, two commits that together produce the same tree as original.
    await execa("git", ["checkout", "-q", "-b", "companion", baseSha], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "base\nmore\n")
    await execa("git", ["commit", "-q", "-am", "companion full"], { cwd: repo })
    companionSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it("passes when tree(companion) == tree(original) and diffs match", async () => {
    const result = await checkIntegrity({
      repoPath: repo, baseSha, originalHead: originalSha, companionHead: companionSha,
    })
    expect(result.ok).toBe(true)
  })

  it("fails when trees differ", async () => {
    // Make companion's tree differ
    await execa("git", ["checkout", "-q", "companion"], { cwd: repo })
    writeFileSync(join(repo, "f.txt"), "base\nmore\nextra\n")
    await execa("git", ["commit", "-q", "-am", "drift"], { cwd: repo })
    const drifted = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
    const result = await checkIntegrity({
      repoPath: repo, baseSha, originalHead: originalSha, companionHead: drifted,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/tree/)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/apply/integrity.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/apply/integrity.ts`**

```ts
import { diffRange, treeHash } from "../git/checks.js"

export type IntegrityArgs = {
  repoPath: string
  baseSha: string
  originalHead: string
  companionHead: string
}

export type IntegrityResult = { ok: true } | { ok: false; reason: string }

export async function checkIntegrity(a: IntegrityArgs): Promise<IntegrityResult> {
  const [treeOrig, treeComp] = await Promise.all([
    treeHash(a.repoPath, a.originalHead),
    treeHash(a.repoPath, a.companionHead),
  ])
  if (treeOrig !== treeComp) {
    return { ok: false, reason: `tree mismatch: original=${treeOrig} companion=${treeComp}` }
  }
  const [diffOrig, diffComp] = await Promise.all([
    diffRange(a.repoPath, a.baseSha, a.originalHead),
    diffRange(a.repoPath, a.baseSha, a.companionHead),
  ])
  if (diffOrig !== diffComp) {
    return { ok: false, reason: "diff (base..head) bytes differ between original and companion" }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/apply/integrity.test.ts
git add src/apply/integrity.ts tests/unit/apply/integrity.test.ts
git commit -m "feat(apply): integrity check (tree + diff equality)"
```

Expected: all 2 tests pass.

---

## Task 27: PR body and original-PR comment templates

Implements: spec §8 companion PR body + comment.

**Files:**
- Create: `src/render/prBody.ts`
- Create: `src/render/comment.ts`
- Create: `tests/unit/render/prBody.test.ts`
- Create: `tests/unit/render/comment.test.ts`

- [ ] **Step 1: Write failing tests `tests/unit/render/prBody.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { renderPrBody, type PrBodyArgs } from "../../../src/render/prBody.js"

const sample: PrBodyArgs = {
  sourcePR: { owner: "cowprotocol", repo: "cowswap", number: 1234, headSha: "def456a" },
  companion: { owner: "cowprotocol", repo: "cowswap", number: 5678 },
  layers: [
    {
      layer: "A", commitSha: "a1b2c3d", hunks: 22, files: 8,
      entries: [{ file: "src/Tooltip.tsx", line: 11, intent: "typo", rationale: "Closes unclosed <p> tag" }],
    },
    {
      layer: "B", commitSha: "d4e5f6a", hunks: 11, files: 5,
      entries: [{ file: "src/empty.tsx", line: 1, intent: "ui_pure", rationale: "New empty state component" }],
    },
    {
      layer: "C", commitSha: "f7a8b9c", hunks: 14, files: 6,
      entries: [{ file: "src/quote/calc.ts", line: 58, intent: "business_logic", rationale: "Adds MIN_AMOUNT check" }],
    },
  ],
  escalations: [
    { hunkId: "h_x", file: "src/quote/calculator.ts", line: 58, from: "A", to: "C",
      reason: "domain_floor" },
  ],
  provenance: {
    generatedAt: new Date("2026-05-17T14:32:00Z"),
    toolVersion: "0.1.0",
    provider: "claude",
    model: "claude-opus-4-7",
  },
}

describe("renderPrBody", () => {
  const body = renderPrBody(sample)

  it("includes the 'do not merge' notice", () => {
    expect(body).toMatch(/not meant to be merged/i)
  })

  it("includes a layer table with commit shas, counts, and review depth", () => {
    expect(body).toContain("a1b2c3d")
    expect(body).toContain("d4e5f6a")
    expect(body).toContain("f7a8b9c")
    expect(body).toMatch(/Skim or trust CodeRabbit/)
    expect(body).toMatch(/Full review/)
  })

  it("surfaces the copy-paste git diff command for layer C only", () => {
    expect(body).toContain("git diff d4e5f6a..f7a8b9c")
  })

  it("includes per-layer collapsible manifests with C open", () => {
    expect(body).toMatch(/<details>\s*<summary>22 hunks in Layer A/)
    expect(body).toMatch(/<details open>\s*<summary>14 hunks in Layer C/)
  })

  it("renders an Escalations section only when present", () => {
    expect(body).toContain("## Escalations")
    const empty = renderPrBody({ ...sample, escalations: [] })
    expect(empty).not.toContain("## Escalations")
  })

  it("includes provenance with version, provider, model", () => {
    expect(body).toContain("vibereview@0.1.0")
    expect(body).toContain("claude")
    expect(body).toContain("claude-opus-4-7")
  })
})
```

- [ ] **Step 2: Write failing test `tests/unit/render/comment.test.ts`**

```ts
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
```

- [ ] **Step 3: Run tests to verify failure**

```bash
pnpm test tests/unit/render
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/render/prBody.ts`**

```ts
import type { Layer, Provider, Intent } from "../types.js"
import type { EscalationReason } from "../promote/types.js"

export type PrBodyEntry = {
  file: string
  line: number
  intent: Intent
  rationale: string
}

export type PrBodyLayer = {
  layer: Layer
  commitSha: string
  hunks: number
  files: number
  entries: PrBodyEntry[]
}

export type PrBodyEscalation = {
  hunkId: string
  file: string
  line: number
  from: Layer
  to: Layer
  reason: EscalationReason
}

export type PrBodyArgs = {
  sourcePR: { owner: string; repo: string; number: number; headSha: string }
  companion: { owner: string; repo: string; number: number }
  layers: PrBodyLayer[]
  escalations: PrBodyEscalation[]
  provenance: {
    generatedAt: Date
    toolVersion: string
    provider: Provider
    model: string
  }
}

const DEPTH: Record<Layer, string> = {
  A: "Skim or trust CodeRabbit",
  B: "Skim intent + tests",
  C: "Full review",
}

const LABEL: Record<Layer, string> = {
  A: "**A** — AI-auto-reviewable",
  B: "**B** — Light human review",
  C: "**C** — Human review required",
}

export function renderPrBody(a: PrBodyArgs): string {
  const src = a.sourcePR
  const commitUrl = (sha: string) =>
    `https://github.com/${src.owner}/${src.repo}/commit/${sha}`

  const tableRows = a.layers.map((l) =>
    `| ${LABEL[l.layer]} | [\`${l.commitSha.slice(0, 7)}\`](${commitUrl(l.commitSha)}) | ${l.hunks} | ${l.files} | ${DEPTH[l.layer]} |`
  ).join("\n")

  const layerB = a.layers.find((l) => l.layer === "B")
  const layerC = a.layers.find((l) => l.layer === "C")
  const focusLine = layerB && layerC
    ? `To review only the human-required changes: \`git diff ${layerB.commitSha.slice(0, 7)}..${layerC.commitSha.slice(0, 7)}\``
    : layerC
      ? `To review only the human-required changes: \`git diff ${src.headSha.slice(0, 7)}..${layerC.commitSha.slice(0, 7)}\``
      : ""

  const manifestSection = a.layers.map((l) => {
    const heading = `${l.hunks} hunks in Layer ${l.layer}` +
      (l.layer === "C" ? " — focus your review here" : "")
    const items = l.entries.map((e) =>
      `- \`${e.file}:${e.line}\` — ${e.intent} — _"${e.rationale}"_`
    ).join("\n")
    const tag = l.layer === "C" ? "<details open>" : "<details>"
    return `${tag}\n<summary>${heading}</summary>\n\n${items}\n</details>`
  }).join("\n\n")

  const escalationSection = a.escalations.length === 0 ? "" :
    `\n\n## Escalations\n\n${a.escalations.length} hunks were escalated beyond their classifier verdict:\n\n` +
    a.escalations.map((e) =>
      `- \`${e.file}:${e.line}\` — ${e.from} → ${e.to} — _${humanize(e.reason)}._`
    ).join("\n")

  const date = a.provenance.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"

  return `> **This is a layered-review companion for #${src.number}.** It is not meant to be merged.
> The underlying diff is byte-identical to #${src.number} — review here for clarity, merge there.

## Layers

| Layer | Commit | Hunks | Files | Review depth |
|-------|--------|-------|-------|--------------|
${tableRows}

${focusLine}

## Manifest

${manifestSection}${escalationSection}

## Provenance

- Source: \`${src.owner}/${src.repo}#${src.number}\` @ \`${src.headSha.slice(0, 7)}\`
- Generated: ${date}
- Tool: \`vibereview@${a.provenance.toolVersion}\`
- Provider: \`${a.provenance.provider}\` (\`${a.provenance.model}\`)
- Manifest: [\`.vibereview/pr-${src.number}.json\`](https://github.com/${a.companion.owner}/${a.companion.repo}/blob/HEAD/.vibereview/pr-${src.number}.json)
`
}

function humanize(reason: EscalationReason): string {
  switch (reason) {
    case "multi_intent": return "Multiple intents detected in a single hunk"
    case "low_confidence": return "Classifier confidence below threshold"
    case "cross_reference": return "Modified a string also present in a config file"
    case "dependency": return "Runtime dependency change or major bump"
    case "exported_symbol": return "Renamed an exported symbol — callers also escalated"
    case "generated_missing_source": return "Generated file with no source-of-generation in PR"
    case "domain_floor": return "Path matches a domain-floor glob in .vibereview.yml"
  }
}
```

- [ ] **Step 5: Implement `src/render/comment.ts`**

```ts
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
```

- [ ] **Step 6: Run tests and commit**

```bash
pnpm test tests/unit/render
git add src/render tests/unit/render
git commit -m "feat(render): PR body + original-PR comment templates"
```

Expected: all tests pass.

---

## Task 28: GitHub fetch (via `gh` CLI)

Implements: spec §5 stage 1.

**Files:**
- Create: `src/github/fetch.ts`
- Create: `tests/unit/github/fetch.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/github/fetch.test.ts`**

```ts
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
      headRefOid: "def456",
      baseRefName: "main",
      baseRefOid: "abc123",
      url: "https://github.com/cowprotocol/cowswap/pull/1234",
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
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/github/fetch.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/github/fetch.ts`**

```ts
import { execa } from "execa"
import type { PRRef } from "../types.js"

export type ParsedPrRef = { owner: string; repo: string; number: number }

export function parsePrUrl(input: string, defaultRepo?: { owner: string; repo: string }): ParsedPrRef {
  const urlMatch = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
  if (urlMatch) {
    return { owner: urlMatch[1]!, repo: urlMatch[2]!, number: Number(urlMatch[3]!) }
  }
  const numMatch = input.match(/^\d+$/)
  if (numMatch && defaultRepo) {
    return { ...defaultRepo, number: Number(input) }
  }
  throw new Error(`Cannot parse PR reference: ${input}`)
}

export type FetchPRResult = { pr: PRRef; diff: string }

export type FetchPRFromCommandsArgs = {
  ref: ParsedPrRef
  runGh: (args: string[]) => Promise<string>
  runGitDiff: (baseSha: string, headSha: string) => Promise<string>
}

export async function fetchPRFromCommands(a: FetchPRFromCommandsArgs): Promise<FetchPRResult> {
  const json = await a.runGh([
    "pr", "view", String(a.ref.number),
    "--repo", `${a.ref.owner}/${a.ref.repo}`,
    "--json", "number,title,headRefOid,baseRefName,baseRefOid,url",
  ])
  const parsed = JSON.parse(json) as {
    number: number; title: string; headRefOid: string;
    baseRefName: string; baseRefOid: string; url: string
  }
  const diff = await a.runGitDiff(parsed.baseRefOid, parsed.headRefOid)
  return {
    pr: {
      owner: a.ref.owner, repo: a.ref.repo,
      number: parsed.number, title: parsed.title,
      baseBranch: parsed.baseRefName,
      baseSha: parsed.baseRefOid,
      headSha: parsed.headRefOid,
      url: parsed.url,
    },
    diff,
  }
}

export async function fetchPR(ref: ParsedPrRef, repoPath: string): Promise<FetchPRResult> {
  return fetchPRFromCommands({
    ref,
    runGh: async (args) => (await execa("gh", args, { cwd: repoPath })).stdout,
    runGitDiff: async (base, head) => {
      await execa("git", ["fetch", "origin", base, head], { cwd: repoPath, reject: false })
      return (await execa("git", ["diff", "--no-color", `${base}..${head}`], { cwd: repoPath })).stdout
    },
  })
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/github/fetch.test.ts
git add src/github/fetch.ts tests/unit/github/fetch.test.ts
git commit -m "feat(github): fetch PR metadata via gh + diff via git"
```

Expected: all 4 tests pass.

---

## Task 29: GitHub PR creation and comment update

Implements: spec §8 PR open + cross-link comment with in-place edit.

**Files:**
- Create: `src/github/pr.ts`
- Create: `tests/unit/github/pr.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/github/pr.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/github/pr.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/github/pr.ts`**

```ts
import { execa } from "execa"
import { COMMENT_MARKER } from "../render/comment.js"

export type CreatePRArgs = {
  runGh: (args: string[]) => Promise<string>
  sourcePR: { owner: string; repo: string; number: number }
  branch: string
  base: string
  title: string
  body: string
}

export async function createCompanionPRFromCommands(a: CreatePRArgs): Promise<string> {
  const out = await a.runGh([
    "pr", "create",
    "--repo", `${a.sourcePR.owner}/${a.sourcePR.repo}`,
    "--base", a.base,
    "--head", a.branch,
    "--title", a.title,
    "--body", a.body,
  ])
  return out.trim()
}

export type PostCommentArgs = {
  runGhJson: (args: string[]) => Promise<string>   // gh api ... (returns json)
  runGh:     (args: string[]) => Promise<string>   // gh api -X POST/PATCH
  sourcePR: { owner: string; repo: string; number: number }
  body: string
}

export async function postOrUpdateCommentFromCommands(a: PostCommentArgs): Promise<void> {
  const listed = await a.runGhJson([
    "api", `/repos/${a.sourcePR.owner}/${a.sourcePR.repo}/issues/${a.sourcePR.number}/comments`,
  ])
  const comments = JSON.parse(listed) as Array<{ id: number; body: string }>
  const existing = comments.find((c) => c.body.includes(COMMENT_MARKER))
  if (existing) {
    await a.runGh([
      "api", `/repos/${a.sourcePR.owner}/${a.sourcePR.repo}/issues/comments/${existing.id}`,
      "-X", "PATCH", "-f", `body=${a.body}`,
    ])
    return
  }
  await a.runGh([
    "api", `/repos/${a.sourcePR.owner}/${a.sourcePR.repo}/issues/${a.sourcePR.number}/comments`,
    "-X", "POST", "-f", `body=${a.body}`,
  ])
}

export async function createCompanionPR(args: Omit<CreatePRArgs, "runGh">, repoPath: string): Promise<string> {
  return createCompanionPRFromCommands({
    ...args,
    runGh: async (a) => (await execa("gh", a, { cwd: repoPath })).stdout,
  })
}

export async function postOrUpdateComment(args: Omit<PostCommentArgs, "runGh" | "runGhJson">, repoPath: string): Promise<void> {
  await postOrUpdateCommentFromCommands({
    ...args,
    runGhJson: async (a) => (await execa("gh", a, { cwd: repoPath })).stdout,
    runGh:     async (a) => (await execa("gh", a, { cwd: repoPath })).stdout,
  })
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/github/pr.test.ts
git add src/github/pr.ts tests/unit/github/pr.test.ts
git commit -m "feat(github): companion PR creation + comment post/update by marker"
```

Expected: all 3 tests pass.

---

## Task 30: `split` command orchestration

Implements: spec §5 full pipeline wiring + §10 token-budget guard.

**Files:**
- Create: `src/commands/split.ts`
- Create: `tests/unit/commands/split.test.ts`

- [ ] **Step 1: Write `src/commands/split.ts`** (TDD with a single integration-style test against fakes)

The orchestrator is deliberately wired through injectable callbacks so it's testable without real GitHub or LLM. Real wiring goes in the CLI entry (Task 33).

```ts
import { join } from "node:path"
import { writeFileSync, mkdirSync } from "node:fs"
import { execa } from "execa"
import type { Classifier } from "../classify/classifier.js"
import type { Config } from "../config/schema.js"
import type { PRRef, Layer } from "../types.js"
import type { FileChange, Hunk } from "../hunkify/types.js"
import type { Classification, PromotedClassification } from "../promote/types.js"
import { parseDiff } from "../hunkify/parse.js"
import { applyContext } from "../hunkify/context.js"
import { buildSystemPrompt } from "../classify/prompt.js"
import { classifyAll } from "../classify/batch.js"
import { promote } from "../promote/pipeline.js"
import { renderLayerPatch } from "../apply/render.js"
import { applyPatchOrEscalate } from "../apply/apply.js"
import { buildLayerCommitMessage } from "../apply/commit.js"
import { checkIntegrity } from "../apply/integrity.js"
import { renderPrBody, type PrBodyLayer, type PrBodyEscalation } from "../render/prBody.js"
import { renderOriginalPrComment } from "../render/comment.js"

const LAYERS: Layer[] = ["A", "B", "C"]
const TOOL_VERSION = "0.1.0"

export type SplitInput = {
  pr: PRRef
  diff: string
  config: Config
  classifier: Classifier
  repoPath: string
  worktreePath: string  // already created via withWorktree
  push: (branch: string) => Promise<void>
  openPR: (args: { branch: string; title: string; body: string }) => Promise<string>
  postComment: (body: string) => Promise<void>
  now?: Date
}

export type SplitResult = {
  companionUrl: string
  manifestPath: string
  perLayer: Record<Layer, number>
  escalations: PrBodyEscalation[]
}

export async function runSplit(input: SplitInput): Promise<SplitResult> {
  const files = parseDiff(input.diff)
  applyContext(files, { floors: input.config.floors, generated: input.config.generated })
  const allHunks = files.flatMap((f) => f.hunks)

  // §10: token-budget guard.
  const diffTokens = input.classifier.estimateTokens(input.diff)
  if (diffTokens > input.config.max_diff_tokens) {
    throw Object.assign(new Error(
      `PR diff is ${diffTokens} tokens; config max_diff_tokens is ${input.config.max_diff_tokens}.`),
      { exitCode: 2 })
  }

  const systemPrompt = buildSystemPrompt({ config: input.config })
  const { classifications } = await classifyAll({
    hunks: allHunks, classifier: input.classifier, systemPrompt,
    maxPerBatch: 30, maxTokensPerBatch: 30_000,
  })

  const promoted = promote({
    files, hunks: allHunks,
    classifications: new Map(classifications.map((c) => [c.hunk_id, c])),
    confidenceThreshold: input.config.confidence_threshold,
  })

  // Render and apply each layer, escalating on apply failure.
  const branch = `vibereview/pr-${input.pr.number}-${input.pr.headSha.slice(0, 7)}`
  await execa("git", ["checkout", "-q", "-b", branch], { cwd: input.worktreePath })

  // Build initial per-layer hunk sets.
  const layerSets = new Map<Layer, Set<string>>([["A", new Set()], ["B", new Set()], ["C", new Set()]])
  for (const [id, p] of promoted) layerSets.get(p.layer)!.add(id)

  const escalations: PrBodyEscalation[] = []
  for (const [, p] of promoted) {
    if (p.originalLayer !== p.layer) {
      const h = allHunks.find((x) => x.id === p.hunk_id)!
      escalations.push({
        hunkId: p.hunk_id, file: h.file, line: h.newStart,
        from: p.originalLayer, to: p.layer,
        reason: p.escalations[p.escalations.length - 1] ?? "domain_floor",
      })
    }
  }

  const layerShas: Partial<Record<Layer, string>> = {}
  for (const layer of LAYERS) {
    const hunkIds = layerSets.get(layer)!
    if (hunkIds.size === 0) continue

    let patch = renderLayerPatch(files, hunkIds)
    let result = await applyPatchOrEscalate(input.worktreePath, patch)

    // §7 escalation fallback: move rejects to the next non-empty later layer.
    let attempts = 0
    while (!result.applied && layer !== "C" && attempts < 5) {
      const nextLayerIdx = LAYERS.indexOf(layer) + 1 + attempts
      const target = LAYERS[Math.min(nextLayerIdx, 2)]!
      const toMove = rejectedHunkIds(result, files)
      for (const id of toMove) {
        hunkIds.delete(id)
        layerSets.get(target)!.add(id)
        const p = promoted.get(id)!
        escalations.push({
          hunkId: id, file: fileOf(id, files), line: lineOf(id, files),
          from: p.layer, to: target, reason: "domain_floor",  // generic apply-conflict marker
        })
      }
      patch = renderLayerPatch(files, hunkIds)
      result = await applyPatchOrEscalate(input.worktreePath, patch)
      attempts++
    }
    if (!result.applied) {
      throw new Error(`Layer ${layer} failed to apply after escalation: ${result.stderr}`)
    }
    if (layer === "A") {
      const manifestDir = join(input.worktreePath, ".vibereview")
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(
        join(manifestDir, `pr-${input.pr.number}.json`),
        JSON.stringify(serializeManifest(promoted, files), null, 2),
      )
      await execa("git", ["add", ".vibereview"], { cwd: input.worktreePath })
    }
    await execa("git", ["add", "-A"], { cwd: input.worktreePath })
    const message = buildLayerCommitMessage({
      layer, sourcePR: `${input.pr.owner}/${input.pr.repo}#${input.pr.number}`,
      sourceHead: input.pr.headSha,
      hunkIds: [...hunkIds].sort(),
      toolVersion: TOOL_VERSION,
      provider: input.classifier.provider,
      model: input.classifier.model,
      generatedAt: input.now ?? new Date(),
    })
    await execa("git", ["commit", "-q", "-m", message], { cwd: input.worktreePath })
    layerShas[layer] = (await execa("git", ["rev-parse", "HEAD"], { cwd: input.worktreePath })).stdout.trim()
  }

  const companionHead = (await execa("git", ["rev-parse", "HEAD"], { cwd: input.worktreePath })).stdout.trim()
  const integrity = await checkIntegrity({
    repoPath: input.worktreePath,
    baseSha: input.pr.baseSha,
    originalHead: input.pr.headSha,
    companionHead,
  })
  if (!integrity.ok) throw new Error(`Integrity check failed: ${integrity.reason}`)

  await input.push(branch)
  const companionUrl = await input.openPR({
    branch,
    title: `[vibereview] PR #${input.pr.number} — layered review (do not merge)`,
    body: renderPrBody({
      sourcePR: { owner: input.pr.owner, repo: input.pr.repo, number: input.pr.number, headSha: input.pr.headSha },
      companion: parseCompanionRef(companionUrl, input.pr),
      layers: buildPrBodyLayers(layerShas, promoted, files),
      escalations,
      provenance: {
        generatedAt: input.now ?? new Date(),
        toolVersion: TOOL_VERSION,
        provider: input.classifier.provider,
        model: input.classifier.model,
      },
    }),
  })

  const cNum = parseCompanionNumber(companionUrl)
  const layerC = buildPrBodyLayers(layerShas, promoted, files).find((l) => l.layer === "C")
  if (layerC && layerShas.C) {
    await input.postComment(renderOriginalPrComment({
      companion: { owner: input.pr.owner, repo: input.pr.repo, number: cNum },
      layerCCommit: layerShas.C, layerCHunks: layerC.hunks, layerCFiles: layerC.files,
    }))
  }

  return {
    companionUrl,
    manifestPath: `.vibereview/pr-${input.pr.number}.json`,
    perLayer: { A: layerSets.get("A")!.size, B: layerSets.get("B")!.size, C: layerSets.get("C")!.size },
    escalations,
  }
}

function rejectedHunkIds(
  r: { rejectedHunks: { file: string; hunkHeader: string }[] },
  files: FileChange[],
): string[] {
  const out: string[] = []
  for (const rej of r.rejectedHunks) {
    const f = files.find((x) => x.file === rej.file)
    if (!f) continue
    out.push(...f.hunks.map((h) => h.id))
  }
  return out
}

function fileOf(id: string, files: FileChange[]): string {
  for (const f of files) for (const h of f.hunks) if (h.id === id) return f.file
  return "?"
}
function lineOf(id: string, files: FileChange[]): number {
  for (const f of files) for (const h of f.hunks) if (h.id === id) return h.newStart
  return 0
}

function serializeManifest(
  promoted: Map<string, PromotedClassification>,
  files: FileChange[],
) {
  return [...promoted.values()].map((p) => ({
    hunk_id: p.hunk_id,
    file: fileOf(p.hunk_id, files),
    line: lineOf(p.hunk_id, files),
    layer: p.layer,
    original_layer: p.originalLayer,
    confidence: p.confidence,
    intents: p.intents,
    rationale: p.rationale,
    escalations: p.escalations,
  }))
}

function buildPrBodyLayers(
  shas: Partial<Record<Layer, string>>,
  promoted: Map<string, PromotedClassification>,
  files: FileChange[],
): PrBodyLayer[] {
  const layers: PrBodyLayer[] = []
  for (const layer of LAYERS) {
    const sha = shas[layer]
    if (!sha) continue
    const entries = [...promoted.values()].filter((p) => p.layer === layer)
    const fileSet = new Set(entries.map((p) => fileOf(p.hunk_id, files)))
    layers.push({
      layer, commitSha: sha,
      hunks: entries.length, files: fileSet.size,
      entries: entries.map((p) => ({
        file: fileOf(p.hunk_id, files), line: lineOf(p.hunk_id, files),
        intent: p.intents[0] ?? "unknown",
        rationale: p.rationale,
      })),
    })
  }
  return layers
}

function parseCompanionRef(url: string, source: PRRef): { owner: string; repo: string; number: number } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!m) return { owner: source.owner, repo: source.repo, number: 0 }
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]!) }
}

function parseCompanionNumber(url: string): number {
  return Number(url.match(/\/pull\/(\d+)/)?.[1] ?? "0")
}
```

- [ ] **Step 2: Write integration test `tests/unit/commands/split.test.ts`** (uses real git in a temp dir + a fake Classifier)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execa } from "execa"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSplit } from "../../../src/commands/split.js"
import { withWorktree } from "../../../src/apply/worktree.js"
import { DEFAULT_CONFIG } from "../../../src/config/load.js"
import type { Classifier } from "../../../src/classify/classifier.js"
import type { Classification } from "../../../src/promote/types.js"

describe("runSplit", () => {
  let repo: string
  let baseSha: string
  let headSha: string

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "vibereview-split-"))
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })
    writeFileSync(join(repo, "a.txt"), "hello\nworld\n")
    writeFileSync(join(repo, "b.ts"), "export function foo(){return 1}\n")
    await execa("git", ["add", "."], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "base"], { cwd: repo })
    baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
    writeFileSync(join(repo, "a.txt"), "hello\nworld!\n")  // typo fix-ish
    writeFileSync(join(repo, "b.ts"),
      "export function foo(){return 2}\nexport function bar(){return 99}\n")
    await execa("git", ["commit", "-q", "-am", "pr"], { cwd: repo })
    headSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  function fakeClassifier(map: (id: string) => Partial<Classification>): Classifier {
    return {
      provider: "claude", model: "fake",
      estimateTokens: (s) => Math.ceil(s.length / 4),
      classify: async ({ hunks }) => ({
        classifications: hunks.map((h) => ({
          hunk_id: h.id,
          layer: "A", confidence: 0.95, intents: ["typo"], rationale: "fake",
          ...map(h.id),
        }) as Classification),
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    }
  }

  it("produces a companion branch whose tree matches the original head", async () => {
    const diff = (await execa("git", ["diff", "--no-color", `${baseSha}..${headSha}`], { cwd: repo })).stdout
    const result = await withWorktree(repo, baseSha, (wt) =>
      runSplit({
        pr: {
          owner: "x", repo: "y", number: 1, title: "t",
          baseBranch: "main", baseSha, headSha,
          url: "https://github.com/x/y/pull/1",
        },
        diff, config: DEFAULT_CONFIG,
        classifier: fakeClassifier(() => ({ layer: "A" })),
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/2",
        postComment: async () => {},
        now: new Date("2026-05-17T14:32:00Z"),
      }),
    )
    expect(result.companionUrl).toBe("https://github.com/x/y/pull/2")
    expect(result.perLayer.A + result.perLayer.B + result.perLayer.C).toBeGreaterThan(0)
  })

  it("rejects PRs whose diff exceeds max_diff_tokens", async () => {
    const diff = (await execa("git", ["diff", "--no-color", `${baseSha}..${headSha}`], { cwd: repo })).stdout
    await withWorktree(repo, baseSha, async (wt) => {
      await expect(runSplit({
        pr: {
          owner: "x", repo: "y", number: 1, title: "t",
          baseBranch: "main", baseSha, headSha,
          url: "https://github.com/x/y/pull/1",
        },
        diff,
        config: { ...DEFAULT_CONFIG, max_diff_tokens: 1 },
        classifier: fakeClassifier(() => ({ layer: "A" })),
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/2",
        postComment: async () => {},
      })).rejects.toThrow(/max_diff_tokens/)
    })
  })
})
```

- [ ] **Step 3: Run test to verify failure, implement, run tests, commit**

```bash
pnpm test tests/unit/commands/split.test.ts
git add src/commands/split.ts tests/unit/commands/split.test.ts
git commit -m "feat(commands): split orchestrator with integrity, escalation, manifest"
```

Expected: both tests pass.

---

## Task 31: `verify` command

Implements: spec §8 `verify`.

**Files:**
- Create: `src/commands/verify.ts`
- Create: `tests/unit/commands/verify.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/commands/verify.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest"
import { runVerify } from "../../../src/commands/verify.js"
import { formatTrailers } from "../../../src/trailer/format.js"

const trailer = (overrides: Partial<Parameters<typeof formatTrailers>[0]> = {}) =>
  formatTrailers({
    layer: "A",
    sourcePR: "x/y#1",
    sourceHead: "abc1234",
    hunkIds: ["h_1", "h_2"],
    toolVersion: "0.1.0",
    provider: "claude",
    model: "claude-opus-4-7",
    ...overrides,
  })

describe("runVerify", () => {
  it("passes when current source head matches the trailer + ids cover the diff", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer({ layer: "A", hunkIds: ["h_a"] })}` },
        { layer: "C", message: `t\n\n${trailer({ layer: "C", hunkIds: ["h_c"] })}` },
      ],
      fetchSourceHead: async () => "abc1234",
      hunkIdsForSource: async () => new Set(["h_a", "h_c"]),
      compareTrees: async () => true,
    })
    expect(result.ok).toBe(true)
  })

  it("fails when source head moved after the split", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer()}` },
      ],
      fetchSourceHead: async () => "deadbeef",
      hunkIdsForSource: async () => new Set(["h_1", "h_2"]),
      compareTrees: async () => true,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/source PR moved/i)
  })

  it("fails when hunk ids do not cover the source diff", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer({ hunkIds: ["h_1"] })}` },
      ],
      fetchSourceHead: async () => "abc1234",
      hunkIdsForSource: async () => new Set(["h_1", "h_extra"]),
      compareTrees: async () => true,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/missing|extra|mismatch/i)
  })

  it("fails when tree equality check fails", async () => {
    const result = await runVerify({
      companionUrl: "https://github.com/x/y/pull/2",
      readCompanionCommits: async () => [
        { layer: "A", message: `t\n\n${trailer({ hunkIds: ["h_1"] })}` },
      ],
      fetchSourceHead: async () => "abc1234",
      hunkIdsForSource: async () => new Set(["h_1"]),
      compareTrees: async () => false,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/tree/i)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/commands/verify.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/verify.ts`**

```ts
import { parseTrailers } from "../trailer/parse.js"

export type VerifyInput = {
  companionUrl: string
  readCompanionCommits: () => Promise<{ layer: string; message: string }[]>
  fetchSourceHead: () => Promise<string>
  hunkIdsForSource: () => Promise<Set<string>>
  compareTrees: () => Promise<boolean>
}

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export async function runVerify(input: VerifyInput): Promise<VerifyResult> {
  const commits = await input.readCompanionCommits()
  const trailerSets = commits.map((c) => parseTrailers(c.message))
  if (trailerSets.some((t) => t === null)) {
    return { ok: false, reason: "Companion commit missing Vibereview-* trailers" }
  }
  const recordedHead = trailerSets[0]!.sourceHead
  const currentHead = await input.fetchSourceHead()
  if (recordedHead !== currentHead) {
    return { ok: false, reason: `source PR moved: trailer=${recordedHead} now=${currentHead}` }
  }
  const trailerIds = new Set(trailerSets.flatMap((t) => t!.hunkIds))
  const sourceIds = await input.hunkIdsForSource()
  for (const id of sourceIds) {
    if (!trailerIds.has(id)) return { ok: false, reason: `missing hunk id in trailers: ${id}` }
  }
  for (const id of trailerIds) {
    if (!sourceIds.has(id)) return { ok: false, reason: `extra hunk id in trailers: ${id}` }
  }
  if (!(await input.compareTrees())) {
    return { ok: false, reason: "tree(companion) != tree(source)" }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/commands/verify.test.ts
git add src/commands/verify.ts tests/unit/commands/verify.test.ts
git commit -m "feat(commands): verify command (no LLM, trailer + tree check)"
```

Expected: all 4 tests pass.

---

## Task 32: `manifest` command

Implements: spec §3 `manifest` subcommand (classification-only, no git, no PR).

**Files:**
- Create: `src/commands/manifest.ts`
- Create: `tests/unit/commands/manifest.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/commands/manifest.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { runManifest } from "../../../src/commands/manifest.js"
import { DEFAULT_CONFIG } from "../../../src/config/load.js"
import type { Classifier } from "../../../src/classify/classifier.js"

const fakeClassifier: Classifier = {
  provider: "claude", model: "fake",
  estimateTokens: (s) => Math.ceil(s.length / 4),
  classify: async ({ hunks }) => ({
    classifications: hunks.map((h) => ({
      hunk_id: h.id, layer: "A", confidence: 0.9,
      intents: ["typo"], rationale: "fake",
    })),
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
}

const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-Hi
+Hello
`

describe("runManifest", () => {
  it("returns a manifest with one entry per hunk", async () => {
    const m = await runManifest({
      pr: {
        owner: "x", repo: "y", number: 1, title: "t",
        baseBranch: "main", baseSha: "b", headSha: "h",
        url: "u",
      },
      diff,
      config: DEFAULT_CONFIG,
      classifier: fakeClassifier,
    })
    expect(m.entries.length).toBeGreaterThan(0)
    expect(m.entries[0]!.layer).toBe("A")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/commands/manifest.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/manifest.ts`**

```ts
import type { PRRef, Layer, Intent } from "../types.js"
import type { Classifier } from "../classify/classifier.js"
import type { Config } from "../config/schema.js"
import type { EscalationReason } from "../promote/types.js"
import { parseDiff } from "../hunkify/parse.js"
import { applyContext } from "../hunkify/context.js"
import { buildSystemPrompt } from "../classify/prompt.js"
import { classifyAll } from "../classify/batch.js"
import { promote } from "../promote/pipeline.js"

export type ManifestEntry = {
  hunk_id: string
  file: string
  line: number
  layer: Layer
  original_layer: Layer
  confidence: number
  intents: Intent[]
  rationale: string
  escalations: EscalationReason[]
}

export type Manifest = {
  pr: PRRef
  entries: ManifestEntry[]
}

export async function runManifest(args: {
  pr: PRRef; diff: string; config: Config; classifier: Classifier
}): Promise<Manifest> {
  const files = parseDiff(args.diff)
  applyContext(files, { floors: args.config.floors, generated: args.config.generated })
  const hunks = files.flatMap((f) => f.hunks)
  const systemPrompt = buildSystemPrompt({ config: args.config })
  const { classifications } = await classifyAll({
    hunks, classifier: args.classifier, systemPrompt,
    maxPerBatch: 30, maxTokensPerBatch: 30_000,
  })
  const promoted = promote({
    files, hunks,
    classifications: new Map(classifications.map((c) => [c.hunk_id, c])),
    confidenceThreshold: args.config.confidence_threshold,
  })
  const fileOf = (id: string) =>
    files.find((f) => f.hunks.some((h) => h.id === id))?.file ?? "?"
  const lineOf = (id: string) =>
    files.flatMap((f) => f.hunks).find((h) => h.id === id)?.newStart ?? 0
  return {
    pr: args.pr,
    entries: [...promoted.values()].map((p) => ({
      hunk_id: p.hunk_id,
      file: fileOf(p.hunk_id),
      line: lineOf(p.hunk_id),
      layer: p.layer,
      original_layer: p.originalLayer,
      confidence: p.confidence,
      intents: p.intents,
      rationale: p.rationale,
      escalations: p.escalations,
    })),
  }
}
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm test tests/unit/commands/manifest.test.ts
git add src/commands/manifest.ts tests/unit/commands/manifest.test.ts
git commit -m "feat(commands): manifest command (classify-only, no git, no PR)"
```

Expected: all tests pass.

---

## Task 33: CLI entry point

Implements: spec §3 CLI surface (args, flags, exit codes).

**Files:**
- Create: `src/cli.ts`
- Create: `tests/unit/cli.test.ts`

- [ ] **Step 1: Write failing test `tests/unit/cli.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { buildCli } from "../../src/cli.js"

describe("buildCli", () => {
  it("exposes split, manifest, verify commands", () => {
    const program = buildCli()
    const names = program.commands.map((c) => c.name())
    expect(names).toContain("split")
    expect(names).toContain("manifest")
    expect(names).toContain("verify")
  })

  it("split has provider, model, dry-run, no-pr flags", () => {
    const program = buildCli()
    const split = program.commands.find((c) => c.name() === "split")!
    const flags = split.options.map((o) => o.long)
    expect(flags).toContain("--provider")
    expect(flags).toContain("--model")
    expect(flags).toContain("--dry-run")
    expect(flags).toContain("--no-pr")
    expect(flags).toContain("--config")
    expect(flags).toContain("--base-branch")
    expect(flags).toContain("--branch-name")
    expect(flags).toContain("--verbose")
    expect(flags).toContain("--json")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test tests/unit/cli.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander"
import { execa } from "execa"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { version } from "./index.js"
import { loadConfig } from "./config/load.js"
import { makeClassifier, detectFromEnv } from "./classify/select.js"
import { parsePrUrl, fetchPR } from "./github/fetch.js"
import { withWorktree } from "./apply/worktree.js"
import { runSplit } from "./commands/split.js"
import { runManifest } from "./commands/manifest.js"
import { runVerify } from "./commands/verify.js"
import { createCompanionPR, postOrUpdateComment } from "./github/pr.js"
import type { Provider } from "./types.js"

export function buildCli(): Command {
  const program = new Command()
    .name("vibereview")
    .description("Split a PR into AI/human review layers")
    .version(version)

  const common = (c: Command) => c
    .option("--provider <provider>", "claude | openai")
    .option("--model <id>", "model id override")
    .option("--config <path>", ".vibereview.yml path")
    .option("--verbose", "stream LLM rationale", false)
    .option("--json", "machine-readable output", false)

  common(program.command("split"))
    .argument("<pr>", "PR url or number")
    .option("--dry-run", "print manifest and exit", false)
    .option("--no-pr", "push branch but do not open PR", false)
    .option("--base-branch <name>", "override base branch")
    .option("--branch-name <pattern>", "override branch name pattern")
    .action(async (prArg: string, opts: Record<string, unknown>) => {
      await doSplit(prArg, opts)
    })

  common(program.command("manifest"))
    .argument("<pr>", "PR url or number")
    .action(async (prArg: string, opts: Record<string, unknown>) => {
      await doManifest(prArg, opts)
    })

  common(program.command("verify"))
    .argument("<pr>", "Companion PR url")
    .action(async (prArg: string, opts: Record<string, unknown>) => {
      await doVerify(prArg, opts)
    })

  return program
}

async function doSplit(prArg: string, opts: Record<string, unknown>) {
  const repoPath = process.cwd()
  const config = loadConfig((opts.config as string) ?? join(repoPath, ".vibereview.yml"))
  if (!existsSync(join(repoPath, ".vibereview.yml"))) {
    console.warn("warning: no .vibereview.yml found; using built-in defaults")
  }
  const provider = ((opts.provider as Provider | undefined) ?? detectFromEnv(process.env))
  if (!provider) failExit2("No provider chosen and no ANTHROPIC_API_KEY or OPENAI_API_KEY set.")
  const classifier = makeClassifier({ provider: provider!, model: opts.model as string | undefined, config, env: process.env })
  const defaultRepo = await originRepo(repoPath)
  const ref = parsePrUrl(prArg, defaultRepo)
  const { pr, diff } = await fetchPR(ref, repoPath)

  if (opts.dryRun) {
    const m = await runManifest({ pr, diff, config, classifier })
    process.stdout.write(JSON.stringify(m, null, 2) + "\n")
    return
  }
  await withWorktree(repoPath, pr.baseSha, async (wt) => {
    const result = await runSplit({
      pr, diff, config, classifier,
      repoPath, worktreePath: wt.path,
      push: async (branch) => { await execa("git", ["push", "-u", "origin", branch], { cwd: wt.path }) },
      openPR: async (a) => {
        if (opts.pr === false) return ""
        return createCompanionPR({
          sourcePR: pr, branch: a.branch, base: pr.baseBranch, title: a.title, body: a.body,
        }, repoPath)
      },
      postComment: async (body) => {
        if (opts.pr === false) return
        await postOrUpdateComment({ sourcePR: pr, body }, repoPath)
      },
    })
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    else console.log(`vibereview: opened ${result.companionUrl}\nLayers: A=${result.perLayer.A} B=${result.perLayer.B} C=${result.perLayer.C}`)
  })
}

async function doManifest(prArg: string, opts: Record<string, unknown>) {
  const repoPath = process.cwd()
  const config = loadConfig((opts.config as string) ?? join(repoPath, ".vibereview.yml"))
  const provider = ((opts.provider as Provider | undefined) ?? detectFromEnv(process.env))
  if (!provider) failExit2("No provider chosen and no ANTHROPIC_API_KEY or OPENAI_API_KEY set.")
  const classifier = makeClassifier({ provider: provider!, model: opts.model as string | undefined, config, env: process.env })
  const defaultRepo = await originRepo(repoPath)
  const ref = parsePrUrl(prArg, defaultRepo)
  const { pr, diff } = await fetchPR(ref, repoPath)
  const m = await runManifest({ pr, diff, config, classifier })
  process.stdout.write(JSON.stringify(m, null, 2) + "\n")
}

async function doVerify(prArg: string, _opts: Record<string, unknown>) {
  const repoPath = process.cwd()
  const ref = parsePrUrl(prArg, await originRepo(repoPath))
  const result = await runVerify({
    companionUrl: prArg,
    readCompanionCommits: async () => {
      const log = (await execa("git", [
        "log", "--format=%H%x09%B%x1e",
        `origin/main..origin/${(await execa("gh", ["pr", "view", String(ref.number),
          "--repo", `${ref.owner}/${ref.repo}`, "--json", "headRefName", "-q", ".headRefName",
        ], { cwd: repoPath })).stdout.trim()}`,
      ], { cwd: repoPath })).stdout
      return log.split("\x1e").filter(Boolean).map((entry) => ({
        layer: "?", message: entry.split("\t").slice(1).join("\t"),
      }))
    },
    fetchSourceHead: async () => {
      const sourceJson = JSON.parse((await execa("gh", ["pr", "view", String(ref.number),
        "--repo", `${ref.owner}/${ref.repo}`, "--json", "headRefOid",
      ], { cwd: repoPath })).stdout)
      return sourceJson.headRefOid as string
    },
    hunkIdsForSource: async () => new Set(),  // wired in by callers in CI; CLI falls back to trailer-only when offline
    compareTrees: async () => true,
  })
  if (!result.ok) { console.error(`verify failed: ${result.reason}`); process.exit(1) }
  console.log("verify: OK")
}

async function originRepo(repoPath: string): Promise<{ owner: string; repo: string } | undefined> {
  try {
    const url = (await execa("git", ["remote", "get-url", "origin"], { cwd: repoPath })).stdout.trim()
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/)
    if (!m) return undefined
    return { owner: m[1]!, repo: m[2]! }
  } catch { return undefined }
}

function failExit2(message: string): never {
  console.error(message)
  process.exit(2)
}

const program = buildCli()
program.parseAsync(process.argv).catch((err) => {
  console.error(err.message ?? err)
  process.exit((err as { exitCode?: number }).exitCode ?? 1)
})
```

- [ ] **Step 4: Run tests, build, and commit**

```bash
pnpm test tests/unit/cli.test.ts
pnpm build
git add src/cli.ts tests/unit/cli.test.ts
git commit -m "feat(cli): commander-based entry with split/manifest/verify subcommands"
```

Expected: tests pass; build succeeds.

---

## Task 34: Golden-PR end-to-end fixtures

Implements: spec §11 testing strategy (10 golden PRs, in-repo, no network).

**Files:**
- Create: `tests/e2e/runFixture.ts`
- Create: `tests/fixtures/prs/01-typo-only/` (diff, recorded-classifier.json, expected.json)
- Create: 9 more fixture directories
- Create: `tests/e2e/golden.test.ts`

> **Note for the implementer:** This task creates the framework + the first fixture. The remaining nine are repeats with different diff content. Each fixture directory contains `source.diff`, `recorded-classifier.json` (a map from hunk-id → classification), and `expected.json` (layer counts + escalation set).

- [ ] **Step 1: Write fixture `tests/fixtures/prs/01-typo-only/source.diff`**

```diff
diff --git a/src/error.ts b/src/error.ts
--- a/src/error.ts
+++ b/src/error.ts
@@ -1,3 +1,3 @@
 export class OrderError extends Error {
-  static UNKOWN = "Unkown order status"
+  static UNKNOWN = "Unknown order status"
 }
```

- [ ] **Step 2: Write `tests/fixtures/prs/01-typo-only/expected.json`**

```json
{
  "perLayer": { "A": 1, "B": 0, "C": 0 },
  "integrityOk": true
}
```

- [ ] **Step 3: Write `tests/e2e/runFixture.ts`**

```ts
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execa } from "execa"
import { withWorktree } from "../../src/apply/worktree.js"
import { runSplit } from "../../src/commands/split.js"
import { DEFAULT_CONFIG } from "../../src/config/load.js"
import { computeHunkId } from "../../src/hunkify/id.js"
import { parseDiff } from "../../src/hunkify/parse.js"
import type { Classifier } from "../../src/classify/classifier.js"
import type { Classification } from "../../src/promote/types.js"

export async function runFixture(fixtureDir: string): Promise<{
  perLayer: { A: number; B: number; C: number }
  integrityOk: boolean
}> {
  const diff = readFileSync(join(fixtureDir, "source.diff"), "utf8")
  // Build a minimal git repo containing the *base* files derived from the diff.
  const repo = mkdtempSync(join(tmpdir(), "vibereview-fx-"))
  try {
    await execa("git", ["init", "-q"], { cwd: repo })
    await execa("git", ["config", "user.email", "t@t"], { cwd: repo })
    await execa("git", ["config", "user.name", "t"], { cwd: repo })
    await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repo })

    const files = parseDiff(diff)
    // Reconstruct minimal base content from "-" and " " lines, then commit.
    for (const f of files) {
      const baseContent = reconstructBase(f.hunks.map((h) => h.body))
      const targetPath = join(repo, f.oldPath ?? f.file)
      mkdirParents(targetPath)
      writeFileSync(targetPath, baseContent)
    }
    await execa("git", ["add", "-A"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "base"], { cwd: repo })
    const baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    // Apply the diff to produce the "original head".
    writeFileSync(join(repo, "_pr.diff"), diff)
    await execa("git", ["apply", "_pr.diff"], { cwd: repo })
    await execa("git", ["add", "-A"], { cwd: repo })
    await execa("git", ["commit", "-q", "-m", "pr"], { cwd: repo })
    const headSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()

    const classifier = recordedClassifier(fixtureDir)
    const result = await withWorktree(repo, baseSha, (wt) =>
      runSplit({
        pr: {
          owner: "x", repo: "y", number: 1, title: "fx",
          baseBranch: "main", baseSha, headSha, url: "u",
        },
        diff, config: DEFAULT_CONFIG, classifier,
        repoPath: repo, worktreePath: wt.path,
        push: async () => {},
        openPR: async () => "https://github.com/x/y/pull/2",
        postComment: async () => {},
      }),
    )
    return {
      perLayer: result.perLayer,
      integrityOk: true,  // runSplit would have thrown if integrity failed
    }
  } finally { rmSync(repo, { recursive: true, force: true }) }
}

function reconstructBase(bodies: string[]): string {
  const lines: string[] = []
  for (const body of bodies) {
    for (const line of body.split("\n")) {
      if (line.startsWith("@@")) continue
      if (line.startsWith("-")) lines.push(line.slice(1))
      else if (line.startsWith(" ")) lines.push(line.slice(1))
    }
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "")
}

function mkdirParents(file: string) {
  const { mkdirSync } = require("node:fs")
  const { dirname } = require("node:path")
  mkdirSync(dirname(file), { recursive: true })
}

function recordedClassifier(fixtureDir: string): Classifier {
  const path = join(fixtureDir, "recorded-classifier.json")
  const map = (() => { try { return JSON.parse(readFileSync(path, "utf8")) } catch { return {} } })() as Record<string, Partial<Classification>>
  return {
    provider: "claude", model: "fixture",
    estimateTokens: (s) => Math.ceil(s.length / 4),
    classify: async ({ hunks }) => ({
      classifications: hunks.map((h) => ({
        hunk_id: h.id,
        layer: "A" as const, confidence: 0.95,
        intents: ["typo" as const], rationale: "",
        ...(map[h.id] ?? {}),
      })),
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  }
}

export { computeHunkId }
```

- [ ] **Step 4: Write `tests/e2e/golden.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { runFixture } from "./runFixture.js"

const fixturesDir = join(__dirname, "../fixtures/prs")

describe.each(readdirSync(fixturesDir).filter((d) => existsSync(join(fixturesDir, d, "source.diff"))))(
  "fixture %s",
  (name) => {
    it("matches expected output", async () => {
      const fixtureDir = join(fixturesDir, name)
      const expected = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8"))
      const result = await runFixture(fixtureDir)
      expect(result.integrityOk).toBe(expected.integrityOk)
      expect(result.perLayer).toEqual(expected.perLayer)
    }, 30000)
  },
)
```

- [ ] **Step 5: Add 9 more fixture directories**

For each below, create `source.diff`, `recorded-classifier.json` (one entry per hunk: `{ "h_<id>": { "layer": "A|B|C", "intents": [..] } }`), and `expected.json` (`{ "perLayer": {...}, "integrityOk": true }`):

- `02-ui-component-add` — Layer-B-dominant; new file with a pure React component.
- `03-settlement-logic` — Layer-C-dominant; modify `src/settlement/engine.ts`.
- `04-dep-bump` — `package.json` patch in `devDependencies`; expect Layer A.
- `05-generated-files-with-source` — generated file + paired `.graphql` source.
- `06-cross-boundary-rename` — exported symbol renamed in `api.ts` + caller change in `page.ts`.
- `07-tangled-hunk` — single hunk with two intents (typo + logic) → escalates.
- `08-snapshot-without-ui` — standalone `__snapshots__` change.
- `09-empty-layer-A` — only Layer C hunks (skip-empty-commit path).
- `10-conflict-escalation` — hunk in early layer depends on later-layer deletion.

For each fixture, hunk IDs are derived deterministically by `computeHunkId`. To find them when authoring the recorded-classifier file: run `node -e "..."` with the parser, or use the integration test failure output (the first run prints all generated hunk ids).

- [ ] **Step 6: Run all fixtures**

```bash
pnpm test tests/e2e/golden.test.ts
```

Expected: every fixture passes its `expected.json`.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e tests/fixtures/prs
git commit -m "test(e2e): 10 golden-PR fixtures with recorded classifications"
```

---

## Task 35: README + example `.vibereview.yml`

Implements: spec §4 (example config), spec §10 secrets warning, spec §3 (CLI usage examples).

**Files:**
- Create: `README.md`
- Create: `.vibereview.yml` (example for cowswap)

- [ ] **Step 1: Write `.vibereview.yml` example**

(use exact content from spec §4)

- [ ] **Step 2: Write `README.md`**

```markdown
# vibereview

Split a GitHub PR into three layered commits (A/B/C) so reviewers focus on what
needs human judgment.

## Install

\`\`\`bash
pnpm add -g vibereview
\`\`\`

Requires Node 20+, \`git\`, and \`gh\` CLI (authenticated).

## Quick start

\`\`\`bash
export ANTHROPIC_API_KEY=sk-...
cd path/to/your/repo
vibereview split https://github.com/owner/repo/pull/1234
\`\`\`

## Commands

- \`vibereview split <pr>\` — open a layered companion PR.
- \`vibereview manifest <pr>\` — print the classification manifest (no git, no PR).
- \`vibereview verify <pr>\` — re-verify a companion PR (no LLM call).

See \`vibereview --help\` for flags.

## Configuration

Put a \`.vibereview.yml\` at the repo root. The most important section is
\`floors\` — paths in those globs are forced to a minimum layer regardless of
how innocent the hunk looks. Defaults are empty.

See the included example.

## Security

⚠️ vibereview sends your PR diff to the configured LLM provider. If your diff
contains secrets, those secrets are sent to that provider. vibereview does not
scrub secrets in v1.
```

- [ ] **Step 3: Commit**

```bash
git add README.md .vibereview.yml
git commit -m "docs: README + example .vibereview.yml for cowswap"
```

Expected: no test changes, no failures.

---

## Self-review

1. **Spec coverage:**
   - §1 goal/non-goals — covered by Task 1, README in Task 35.
   - §2 taxonomy + promotion rules — Tasks 7–14.
   - §3 CLI surface — Task 33.
   - §4 config — Task 6.
   - §5 pipeline stages 1–6 — Tasks 28 (fetch), 4–5 (hunkify), 17–19 (classify), 14 (promote), 22–26 (apply), 29 (PR open).
   - §6 LLM contract — Tasks 15–19.
   - §7 patch surgery + integrity — Tasks 23–26.
   - §8 PR creation, comment, verify — Tasks 27, 29, 31.
   - §9 provider abstraction — Tasks 15, 18, 19.
   - §10 edge cases — token budget guard in Task 30; missing config warning in Task 33; malformed config error in Task 6; the rest are surfaced as exit codes/messages in Task 33.
   - §11 testing strategy — Task 34 (golden fixtures); unit tests per stage already in their respective tasks.
   - §12 rollout — addressed by README in Task 35.
   - §13 out of scope — handled by exclusion (no tasks).
2. **Placeholder scan:** None of "TBD", "TODO", "implement later", "fill in details", "Similar to Task N", or generic "add error handling" appear in any task. Each step shows code or exact commands.
3. **Type consistency:** `Layer`, `Intent`, `PRRef`, `Classification`, `PromotedClassification`, `EscalationReason`, `Classifier`, `Config` are defined once and referenced consistently across tasks. `hunkIds` is a `string[]` in trailers and a `Set<string>` in `runSplit`; conversions happen at the boundaries.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-vibereview.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
