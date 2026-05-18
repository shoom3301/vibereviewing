# vibereview split — progress output

## Goal

Make `vibereview split` print human-readable progress while it runs so users can
see what phase it's in. Today the command runs silently until the final
success/error line.

## Behavior

- Progress lines are written to **stderr** (stdout is reserved for `--json`
  payloads and the final human success line).
- Each line is prefixed with `vibereview: ` to match the existing success line.
- Always on when running interactively. Suppressed when `--json` is passed (so
  scripted consumers get clean machine output).
- No spinner, no in-place updates — one line per phase. Plays well with logs.

## Phases printed (in order)

1. `fetching PR #<n> from <owner>/<repo>`
2. `parsed <N> files, <M> hunks`
3. `classifying <M> hunks in <K> batches`
4. `  batch <i>/<K> classified (<n> hunks)` — one per batch
5. `applying layer A (<n> hunks)` or `layer A: no hunks` — repeated for B, C
6. `verifying integrity`
7. `writing manifest`
8. `pushing branch <name>`
9. `opening companion PR`
10. `commenting on source PR` — only if a comment is posted

Phases 6–10 are skipped on `--dry-run` (the dry-run path returns early after
classification).

## Wiring

Add an optional `onProgress?: (msg: string) => void` parameter to:

- `runSplit` in `src/commands/split.ts`
- `classifyAll` in `src/classify/batch.ts` (for per-batch progress)
- `fetchPR` in `src/github/fetch.ts` (for the fetch line)

The CLI (`src/cli.ts`) constructs a single logger:

```ts
const log = opts.json
  ? () => {}
  : (m: string) => process.stderr.write(`vibereview: ${m}\n`)
```

and threads it down. Omitting the parameter (e.g. in tests) means no output —
backwards compatible.

## Tests

- `classifyAll`: pass a recording `onProgress`, assert one batch-progress
  message per batch.
- `runSplit`: pass a recording `onProgress`, assert the phase sequence appears
  in the expected order.
- CLI-level tests already use `--json`; verify silence there is preserved.

## Out of scope

- The existing `--verbose` flag (described as "stream LLM rationale") is not
  wired up anywhere today. Leaving it untouched. A future change can repurpose
  it to print per-hunk classification rationale.
- No spinner / TTY-aware UI. Reconsider later if users ask.
