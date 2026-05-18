# Vibereview — Design Spec

**Status:** Draft for review
**Date:** 2026-05-17
**Target repo for dogfooding:** `cowprotocol/cowswap`

## 1. Problem and goal

Code review is a bottleneck. Engineers ship a lot of code, and reviewers don't have time to read all of it at full depth. Most diffs contain a mix of mechanical changes (typos, formatting, renames) and high-risk changes (business logic, security, schema). Reviewing them at uniform depth wastes attention on the safe parts and shortchanges the risky parts.

**Vibereview** is a CLI that takes a GitHub PR and produces a *companion* PR whose diff is byte-identical to the original but whose commits are re-organized into three review layers. Reviewers focus their attention on the last commit (Layer C — human-required), can skim or skip earlier commits, and downstream AI reviewers (CodeRabbit, etc.) can act on per-commit metadata. The original PR is what eventually merges; the companion is a review aid.

**Goals (v1):**
- A local CLI: `vibereview split <pr-url>`.
- Per-hunk classification by LLM (Claude or OpenAI), with deterministic post-classification promotion rules.
- Three-commit companion PR (A → B → C); diff equal to original byte-for-byte.
- Per-commit trailers + a committed manifest file for downstream tooling.
- A `verify` subcommand to gate the companion in CI without LLM calls.

**Non-goals (v1):**
- Hosted GitHub App, OAuth login flow, "button on PR" UX. Deferred to v2.
- AI commenting on code quality. Vibereview classifies and re-organizes; it doesn't review.
- Auto-sync of the companion when the original PR updates. User re-runs the CLI.
- Multi-provider ensembling, streaming, cost dashboards.

## 2. Layer taxonomy

Classification is based on review risk, semantic blast radius, and the kinds of judgment required to approve the change.

### Layer A — AI-auto-reviewable

Mechanical changes with provably zero semantic impact:
- Typos, comments, docs, copy with no user-visible string change in trading/auth flows.
- Formatting, lint autofix, import sort, dead-code removal.
- Rename-only changes to *purely internal* symbols (no exports, no string references, no schema/route/i18n keys).
- Pure-function extraction with no captured variables, same file.
- Type annotation changes that do not narrow/widen exported types.
- New unit tests for existing behavior (additive `expect`s only).
- Dev-only patch dependency bumps where the lockfile transitively changes ≤ 5 packages.
- Generated files **iff** their source-of-generation file is also present in the PR and classified ≥ Layer B.
- Snapshot updates **iff** there is also a non-snapshot file in the PR whose path matches the snapshot's stem (e.g., `Foo.test.tsx.snap` paired with `Foo.tsx`) and that paired file is classified ≥ Layer B.
- Trivial config: prettier, editorconfig.

Example: typo fix.

```diff
- throw new Error("Unkown order status")
+ throw new Error("Unknown order status")
```

Example: internal rename.

```diff
- const isValidOrder = validateOrder(order)
- if (!isValidOrder) return null
+ const hasValidOrder = validateOrder(order)
+ if (!hasValidOrder) return null
```

### Layer B — Light human review, AI does the heavy lift

Small localized behavior change with bounded risk:
- New pure UI components (no `useEffect`, no `fetch`/SDK calls, no mutations/signing, no router/store writes, no permission checks).
- Small fixes outside Layer C domain paths with a clear test delta.
- Localized validation/format/display changes without persistence or security impact.
- Code extraction beyond same-file pure functions (closure capture, cross-file).
- Type changes to exported types.
- Cross-boundary renames (exported symbols, i18n keys).
- Non-dev or non-patch dependency updates with bounded transitive delta.
- Build/lint config tightening (eslint, tsconfig).
- Test refactors that change mock setup or remove assertions.

Example: localized logic fix.

```diff
 export function getDisplayPrice(price?: number) {
-  if (!price) return "-"
+  if (price == null) return "-"
   return `$${price.toFixed(2)}`
 }
```

This is Layer B, not Layer A, because `0` now behaves differently.

Example: pure UI component.

```tsx
export function EmptyOrdersState() {
  return (
    <section aria-label="No orders">
      <h2>No orders yet</h2>
      <p>Create your first order to see it here.</p>
    </section>
  )
}
```

### Layer C — Human review required

Everything with domain, architectural, or business judgment:
- Anything in the repo's configured domain-risk paths (see §4).
- Business logic, pricing/matching/risk logic.
- Auth, permissions, sessions, identity, wallet, signing.
- Schema, migration, persistence, cache, queue, event processing.
- Public API contract changes, SDKs, external integrations.
- Major or runtime-dep updates; large transitive deltas.
- Performance-sensitive, concurrency, retry, race, async lifecycle.
- Feature-flag *behavior* changes (not flag plumbing).
- Compliance/analytics semantics.
- Large refactors where behavior preservation isn't mechanically provable.
- Env, CI workflows, runtime configs.
- Any hunk with classifier confidence < threshold.
- Any "tangled" hunk with mixed intents.

Example: business logic.

```diff
 export function canSubmitOrder(order: Order) {
-  return order.amount > 0 && order.walletConnected
+  return order.amount >= MIN_ORDER_AMOUNT && order.walletConnected && !order.isExpired
 }
```

### Deterministic promotion rules

Applied after LLM classification. Rules only escalate, never demote.

1. Domain-risk path match → ≥ C.
2. Exported-symbol rename / signature change → ≥ B.
3. String literal also referenced in `*.json|*.yaml|*.sql|*.env*` → ≥ B.
4. `package.json` major bump or runtime dep → ≥ C.
5. Hunk has more than one logical intent → escalate one layer.
6. Classifier confidence < threshold → escalate one layer.

## 3. CLI surface

```
vibereview split <pr-url-or-number> [flags]

Required:
  <pr-url-or-number>           "https://github.com/cowprotocol/cowswap/pull/1234"
                               or "1234" (uses current repo's origin remote)

Provider selection (auto-detected from env if omitted):
  --provider <claude|openai>   Explicit provider choice
                               Auto: ANTHROPIC_API_KEY → claude; else OPENAI_API_KEY → openai
  --model <id>                 Override default model for the chosen provider

Behavior:
  --config <path>              Path to .vibereview.yml (default: repo root)
  --dry-run                    Print the manifest and exit; don't push or open a PR
  --no-pr                      Push the branch but don't open a companion PR
  --base-branch <name>         Override base detection (default: original PR's base)
  --branch-name <pattern>      Override new branch name pattern
                               (default: "vibereview/pr-<num>-<short-sha>")

Misc:
  --verbose                    Stream LLM rationale to stdout
  --json                       Emit machine-readable manifest to stdout
  --help, --version
```

**Other commands:**

```
vibereview manifest <pr-url>   Classification only; print the manifest. No git, no PR.
vibereview verify <pr-url>     Re-verify an existing companion PR against its source.
                               No LLM call. CI-friendly.
```

## 4. Configuration: `.vibereview.yml`

Lives at repo root, committed. Drives deterministic promotion rules and domain floors so they're version-controlled per-repo.

```yaml
version: 1

# Path globs that force a minimum layer floor. Floors only escalate.
floors:
  C:
    - "**/solver/**"
    - "**/settlement/**"
    - "**/signing/**"
    - "**/quote/**"
    - "**/slippage/**"
    - "**/allowance/**"
    - "**/approval/**"
    - "**/balance/**"
    - "**/gas/**"
    - "**/permit/**"
    - "**/nonce/**"
    - "**/chain/**"
    - "**/*.sol"
    - "**/migrations/**"
    - ".github/workflows/**"
    - ".env*"
  B:
    - "tsconfig*.json"
    - ".eslintrc*"
    - "**/i18n/**"

# Generated files: Layer A only if the source is also in the PR and >= Layer B.
generated:
  - "**/*.generated.ts"
  - "**/__generated__/**"
  - "**/abi/*.json"

# Hunks below this confidence escalate one layer.
confidence_threshold: 0.7

# Pre-LLM guard: fail fast if the diff exceeds this many tokens.
max_diff_tokens: 200000

# LLM provider defaults. Overridable by --provider / --model.
providers:
  claude:
    model: claude-opus-4-7
  openai:
    model: gpt-5
```

Behavior when missing: tool runs with built-in defaults (empty floors and generated globs, threshold 0.7, max 200k tokens), prints a warning. When malformed: hard error, exit 2.

## 5. Pipeline architecture

Six stages, each independently testable.

```
┌───────────────┐    ┌──────────────┐    ┌────────────────┐    ┌─────────────┐
│ 1. Fetch      │───▶│ 2. Hunkify   │───▶│ 3. Classify    │───▶│ 4. Promote  │
│ PR diff + meta│    │ Parse unified│    │ LLM batched    │    │ Apply floors│
└───────────────┘    │ diff → hunks │    │ classification │    │ + rules     │
                     └──────────────┘    └────────────────┘    └─────┬───────┘
                                                                     │
┌────────────────┐   ┌─────────────────┐   ┌──────────────────┐      │
│ 7. Open PR     │◀──│ 6. Push branch  │◀──│ 5. Apply patches │◀─────┘
│ Companion body │   │ + open PR via   │   │ 3 commits        │
│ + metadata     │   │ gh CLI          │   │ + integrity check│
└────────────────┘   └─────────────────┘   └──────────────────┘
```

### Stage 1 — Fetch

GitHub API: PR metadata (title, base, head, SHAs, author). Local git: fetch PR branch into a throwaway worktree at the base SHA. All subsequent stages operate inside this worktree.

### Stage 2 — Hunkify

Parse the unified diff between `base..head` into typed hunk objects. Hunkifying is language-agnostic and deterministic.

```ts
type Hunk = {
  id: string                  // hash of {file, oldStart, oldLines, newStart, newLines, body}
  file: string                // post-rename path
  oldPath: string | null
  oldStart: number; oldLines: number
  newStart: number; newLines: number
  body: string                // literal diff body
  context: {
    fileLanguage: string
    isGenerated: boolean      // matched .vibereview.yml `generated` globs
    domainFloor: "A" | "B" | "C"   // matched `floors`, default A
  }
}
```

### Stage 3 — Classify

Send batches of hunks to the LLM (Claude or OpenAI) with a strict JSON schema response. The LLM only classifies; it never produces patches or commits. Full prompt and schema in §6.

### Stage 4 — Promote

Pure-function pipeline applying every deterministic rule from §2. Execution order (each step's result feeds the next; rules only escalate):

1. Start with LLM's `layer`.
2. **Multi-intent rule (§2 rule 5):** if `intents.length > 1` → escalate one layer.
3. **Confidence rule (§2 rule 6):** if `confidence < threshold` → escalate one layer.
4. **Cross-reference rule (§2 rule 3):** if the hunk adds/removes a string literal also present in any `*.json|*.yaml|*.sql|*.env*` file in the PR → ≥ B.
5. **Dependency rule (§2 rule 4):** if the hunk is in `package.json` and changes a major version or a runtime (non-`devDependencies`) entry → ≥ C.
6. **Exported-symbol rule (§2 rule 2), cross-hunk:** if any hunk renames or changes the signature of an exported symbol, all hunks touching that symbol's definition and known callers escalate together to the same layer ≥ B.
7. **Generated-file rule (§2 Layer A):** if `isGenerated` and the source-of-generation file is not in the PR (or is < Layer B) → C.
8. **Domain-floor rule (§2 rule 1, last so it wins):** `layer = max(layer, context.domainFloor)`.

Order matters: domain floor runs last so it cannot be inadvertently outweighed by a later step.

### Stage 5 — Apply patches

Three commits on the new branch, starting from PR's base SHA. For each layer A → B → C:

1. Render a unified patch containing only that layer's hunks.
2. Apply with `git apply --3way`.
3. On conflict: escalate failing hunks to the earliest later layer in which they apply (worst case: all conflicts → Layer C). Re-render and retry.
4. Commit with templated trailers (§7).

Per-file decomposition rules:
- Hunks sorted by `oldStart` ascending.
- Renames anchored to the earliest layer touching the file; later layers' body hunks operate on the new path.
- Binary files: one atomic hunk, layer = its single classification, no splitting.
- File deletions: go to the layer matching the deletion's classification. Later-layer hunks referencing the deleted file → classifier bug, abort.

### Integrity check

After the three commits exist:

```
git diff <base>..<companion-head> == git diff <base>..<original-head>      # byte-identical
git rev-parse <companion-head>^{tree} == git rev-parse <original-head>^{tree}
```

Both must hold. If either fails, abort, discard the worktree, exit 1 (tool bug). No companion PR is opened.

### Stage 6 — Push and open

`git push` the new branch; `gh pr create` the companion PR; post a comment on the original PR cross-linking. PR body rendering in §8.

Empty layers are skipped — if a PR has no Layer A hunks, the companion has 2 commits, not 3.

## 6. LLM contract

The LLM does one thing: produce JSON classifications. It never sees git, never writes files, never emits a patch. This is the trust boundary.

### Input

Each batch (default 30 hunks, configurable, sized to stay under ~40% of model context):

```json
{
  "pr": {
    "number": 1234,
    "title": "Fix slippage tooltip and refactor quote utils",
    "base_sha": "abc123",
    "head_sha": "def456"
  },
  "hunks": [
    {
      "id": "h_8f4e",
      "file": "src/components/Tooltip.tsx",
      "language": "tsx",
      "isGenerated": false,
      "domainFloor": "A",
      "diff": "@@ -10,3 +10,3 @@\n   <span>{label}</span>\n-  <p>Click for more info<p>\n+  <p>Click for more info</p>"
    }
  ]
}
```

`domainFloor` is sent as advisory context so the LLM produces consistent rationale; the deterministic Promote stage owns the actual floor application.

### Output schema (strict)

Enforced via Anthropic tool-use input_schema / OpenAI structured outputs.

```json
{
  "name": "submit_classifications",
  "input_schema": {
    "type": "object",
    "required": ["classifications"],
    "properties": {
      "classifications": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["hunk_id", "layer", "confidence", "intents", "rationale"],
          "properties": {
            "hunk_id":    { "type": "string" },
            "layer":      { "enum": ["A", "B", "C"] },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "intents":    {
              "type": "array",
              "minItems": 1,
              "items": {
                "enum": [
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
                  "unknown"
                ]
              }
            },
            "rationale": { "type": "string", "maxLength": 400 }
          }
        }
      }
    }
  }
}
```

Two design points:

- **Closed `intents` vocabulary.** Programmatic Promote logic depends on knowing the intent kind. Unknown intents auto-escalate to C. Vocabulary expands in v1.1 based on observed `unknown` rates.
- **One hunk → multiple intents.** Multi-intent is the "tangled hunk" signal; Promote escalates one layer.

### System prompt structure

```
ROLE
You classify code-diff hunks into three review layers (A, B, C).
You do not produce patches. You do not produce code. You only emit
classifications via the submit_classifications tool.

LAYER DEFINITIONS
<inlined from §2>

PROMOTION RULES (informational; applied deterministically after you)
<inlined from §2>

REPO CONFIG
<inlined from .vibereview.yml: floors, generated globs, threshold>

CALIBRATION
- Confidence reflects YOUR certainty about classification, not code correctness.
- If you cannot determine intent in one read, set confidence < threshold and use intent "unknown".
- Prefer the higher layer when uncertain. Cost of over-escalation is small;
  cost of under-escalation is a missed human review.

FORMAT
Call submit_classifications exactly once with every input hunk_id covered.
Missing any hunk_id is a hard error.
```

Calibration is deliberately biased toward Layer C: the human-review safety net is the system's bottom-line guarantee.

### Robustness

- `temperature: 0` for determinism.
- Anthropic prompt caching on the system block + repo config; ~80% input-token savings across batches.
- Coverage check: every input `hunk_id` must appear in the response. Missing → one retry with the missing ids. Second miss → fail run.
- Schema-violation retry: provider-side validation catches most; one structured retry on top.
- Stable `hunk_id` (hash of body) → same hunk yields same id across runs, enabling `verify`.

## 7. Patch surgery and integrity

### Invariant

For every file in the PR:
```
applyPatch(applyPatch(applyPatch(base[f], D_A[f]), D_B[f]), D_C[f]) == head[f]
```

Integrity is non-negotiable; review-surface reduction is best-effort.

### Approach

For each layer A → B → C:

1. Render a unified patch from that layer's hunks, sorted by `oldStart` per file.
2. `git apply --3way` in the worktree. `--3way` uses blob SHAs to handle context drift from prior layers.
3. On rejection: parse rejected hunks, find the earliest later layer where each applies cleanly, move it, retry. Worst case: all conflicts escalate to C.
4. Commit with trailers.

The escalation fallback is logged and surfaced in the companion PR description so reviewers know about it.

### Commit construction

Each layer commit:

```
[Layer A] Mechanical changes — vibereview/pr-1234

Generated by vibereview on 2026-05-17.
This commit groups hunks classified as Layer A (AI-auto-reviewable).
See PR description for the full manifest.

Vibereview-Layer: A
Vibereview-Source-PR: cowprotocol/cowswap#1234
Vibereview-Source-Head: def456abc789
Vibereview-Hunks: h_8f4e,h_2c1a,h_9d77
Vibereview-Tool-Version: 0.1.0
Vibereview-Provider: claude
Vibereview-Model: claude-opus-4-7
```

Per-hunk `{layer, confidence, rationale, intents}` lives in a committed manifest file `.vibereview/pr-<num>.json` (in the first layer commit, on the companion branch only — never reaches the merge target). Trailers are kept terse; the manifest carries detail.

### Final checks

```
git diff <base>..<companion-head> == git diff <base>..<original-head>
git rev-parse <companion-head>^{tree} == git rev-parse <original-head>^{tree}
```

Both equality checks must hold. Failure → abort, no PR opened.

## 8. PR creation, cross-linking, verification

### Companion PR

- **Title:** `[vibereview] PR #1234 — layered review (do not merge)`
- **Base:** same as original PR's base.
- **Author:** whoever ran the CLI (their `gh` auth identity).

Body template:

```markdown
> **This is a layered-review companion for #1234.** It is not meant to be merged.
> The underlying diff is byte-identical to #1234 — review here for clarity, merge there.

## Layers

| Layer | Commit | Hunks | Files | Review depth |
|-------|--------|-------|-------|--------------|
| **A** — AI-auto-reviewable | [`a1b2c3d`](…) | 22 | 8 | Skim or trust CodeRabbit |
| **B** — Light human review | [`d4e5f6a`](…) | 11 | 5 | Skim intent + tests |
| **C** — Human review required | [`f7a8b9c`](…) | 14 | 6 | Full review |

To review only the human-required changes: `git diff d4e5f6a..f7a8b9c`

## Manifest

<details>
<summary>22 hunks in Layer A</summary>
- `src/components/Tooltip.tsx:11` — typo — _"Closes unclosed `<p>` tag"_
- ...
</details>

<details>
<summary>11 hunks in Layer B</summary>...</details>

<details open>
<summary>14 hunks in Layer C — focus your review here</summary>...</details>

## Escalations

(Only shown if any.)

3 hunks were escalated beyond their classifier verdict:
- `src/quote/calculator.ts:58` — A → C — _Apply ordering: context depended on a Layer C deletion._

## Provenance

- Source: `cowprotocol/cowswap#1234` @ `def456a`
- Generated: 2026-05-17 14:32 UTC
- Tool: `vibereview@0.1.0`
- Provider: `claude` (`claude-opus-4-7`)
- Manifest: [`.vibereview/pr-1234.json`](…)
```

The "review only Layer C" git-diff line is the single most important UX moment — surfaced as one copyable command.

### Comment on the original PR

Single comment via `gh api`:

```markdown
🪄 **vibereview**: layered-review companion opened at #5678.

Focus your review on the Layer C commit: [`f7a8b9c`](…) (14 hunks, 6 files).
The underlying diff is byte-identical to this PR.

<!-- vibereview:companion -->
```

Re-runs of `vibereview split` on the same PR **edit this comment in place** (find by the HTML marker) rather than spam.

### Companion PR CI

Runs by default; whatever rules apply to the base branch apply to the companion. We don't bypass branch protection. Repos that want to skip can filter on `head_ref: vibereview/**`.

### `vibereview verify`

CI-friendly counterpart. No LLM call.

1. Parse trailers from each layer commit.
2. Fetch source PR's current HEAD. If ≠ `Vibereview-Source-Head` → "stale companion."
3. Hunkify source PR's current diff. Compare computed `hunk_id`s with the union of trailer hunk ids. Mismatch → fail.
4. Verify integrity invariant (tree equality).

Catches: stale companions, hand-edited layer commits, defense-in-depth against tool bugs.

Recommended CI workflow:

```yaml
# .github/workflows/vibereview-verify.yml
name: vibereview verify
on:
  pull_request:
    branches: [main]
jobs:
  verify:
    if: startsWith(github.head_ref, 'vibereview/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npx vibereview verify ${{ github.event.pull_request.html_url }}
```

## 9. Provider abstraction

A single TS interface, implemented twice:

```ts
interface Classifier {
  readonly provider: "claude" | "openai"
  readonly model: string
  classify(batch: ClassifyRequest): Promise<ClassifyResponse>
  estimateTokens(text: string): number
}

type ClassifyRequest = {
  systemPrompt: string
  hunks: Hunk[]
  schema: JsonSchema
}

type ClassifyResponse = {
  classifications: HunkClassification[]
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
}
```

Everything above this interface — taxonomy, prompt, schema, Promote rules, patch surgery, integrity checks, PR creation — is identical across providers. Everything below is per-provider glue.

| Concern | Claude | OpenAI |
|---|---|---|
| SDK | `@anthropic-ai/sdk` | `openai` |
| Default model | `claude-opus-4-7` | `gpt-5` |
| Structured output | tool-use with `submit_classifications` input_schema | `response_format: { type: "json_schema", strict: true }` |
| Prompt caching | Yes (`cache_control: ephemeral` on system + config blocks) | No in v1 (automatic only; we don't structure for it) |
| Token estimator | `@anthropic-ai/tokenizer` | `tiktoken` |
| Retries | SDK + our coverage/schema retry | Same pattern |

Provider selection:

```ts
const classifier = makeClassifier({
  provider: cli.provider ?? detectFromEnv(),    // ANTHROPIC_API_KEY > OPENAI_API_KEY
  model:    cli.model,
  apiKey:   requireKey(provider),
})
```

Adding a v2 provider: implement `Classifier`. No other code changes.

## 10. Edge cases and failure modes

| Case | Behavior |
|---|---|
| Empty PR / no diff | Exit 0 with message. No companion. |
| Single-hunk PR | Single commit. `git diff` line degenerates to `base..HEAD`. Still correct. |
| Only generated files, no source | All Layer C. Note in PR body. |
| Diff exceeds `max_diff_tokens` | Fail fast pre-LLM. Exit 2 with actionable message. |
| Binary files | One atomic hunk per file. Defaults: Layer B; snapshots follow snapshot rule. |
| Submodule pointer changes | One hunk per submodule. Always Layer C. No LLM call. |
| File mode / symlink changes | One hunk per file. Default Layer B; promoted to C if in domain-floor path. |
| Renames with body changes | Rename anchored to earliest layer touching the file; later hunks use new path. |
| Force-push during run | Captured `<original-head>` at start; trailer records it. `verify` flags stale on next CI. |
| Concurrent runs on same PR | Branch name collision fails second `git push`. Documented: don't run concurrently. |
| User lacks write access to repo | `git push` fails on the new branch. Exit 2 with: "no push access — run from a fork or ask a maintainer." No partial work on GitHub. |
| Secrets in the diff | Out of scope. Sent to LLM as-is. Prominent warning in README. |
| Network failure: GitHub fetch | SDK retry; clean error if exhausted. |
| Network failure: LLM call | Coverage/schema retries on top of SDK retries; fail run on exhaustion. |
| Network failure: `gh pr create` | Branch pushed; surface error with manual rerun command. |
| LLM returns `unknown` intent | Promoted to C. No retry. Logged at `--verbose`. |
| LLM disagrees with itself across retries | Second response wins. Rare; only on coverage retry of malformed first response. |
| `.vibereview.yml` missing | Built-in defaults; warning printed. |
| `.vibereview.yml` malformed | Hard error, exit 2 with line number. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (companion PR opened, or `--dry-run` printed). |
| 1 | Runtime failure (LLM exhausted, integrity violated, push/PR-create failed). |
| 2 | User-fixable input error (diff too large, config malformed, missing API key). |

Every non-zero exit prints an actionable next step. No silent failures, no half-correct companion PRs.

## 11. Testing strategy

### Unit tests per stage

- **Hunkify:** parse-diff fixtures including renames, deletes, binaries, submodules, mode changes. Hunk IDs stable across runs.
- **Promote:** every rule has positive and negative cases. Property test: promotion never demotes.
- **Patch surgery:** golden-input PR diffs split and re-applied, byte-identical to original. Includes the "Layer A typo inside Layer C deletion" case.
- **Trailers / verify:** round-trip a manifest through trailers and back.

### Provider contract tests

Both `ClaudeClassifier` and `OpenAIClassifier` tested against recorded-response fixtures (no live API in CI). Catches SDK API drift and schema-validation regressions.

### Golden-PR end-to-end tests

A small fixtures repo (in-repo, no network) with 10 representative PRs:

1. Typo-only.
2. UI-component addition.
3. Settlement-logic change (exercises domain floor).
4. Dependency bump + lockfile.
5. Generated-files + source.
6. Rename across boundary (promotion rule).
7. Tangled hunk (multi-intent).
8. Snapshot update without paired UI change.
9. Empty Layer A (skip-empty-commit path).
10. Force-conflict requiring escalation in patch surgery.

Each fixture asserts: layer assignments, integrity check passes, trailers match, PR body renders correctly.

### Live smoke test before each release

Run `vibereview split --dry-run` against 3 recent real cowswap PRs. Eyeball the manifest. Catches prompt regressions that unit tests can't.

## 12. Rollout (cowswap dogfooding)

| Week | Milestone |
|---|---|
| 1 | v0.1 CLI. Manual runs on closed PRs. Compare manifest against reviewer-flagged hunks. Tune prompt and floors. |
| 2 | v0.2 CLI. Opt-in `--dry-run` on open PRs by author. |
| 3 | v0.3 CLI. Full runs on open PRs by 2–3 willing authors. Collect reviewer feedback. |
| 4 | v0.4. `verify` CI workflow lands. Companion PRs are routine for participants. |
| Post-v1 | GitHub App / button-on-PR UX (deferred non-goal). |

**Success metric for v1:** on the dogfooding cohort, reviewers report Layer-C focus saved review time, **and** no Layer-C miss (a hunk classified A or B that reviewers later flagged as needing human review) escapes in the first 50 PRs. The latter is the safety invariant; the former is the value prop.

## 13. Out of scope (deferred)

- Hosted GitHub App with login UX and "button on PR." v2.
- Auto-update of companion when original PR changes. v2.
- Multi-provider ensembling / voting. v3 if ever.
- AI commenting on code quality. Vibereview classifies and re-organizes — code-quality review is CodeRabbit's job.
- Per-line review comments on the companion.
- Slack / Linear / Notion notifications.
- Cost dashboards beyond stdout `--verbose` usage prints.
- Secret-scrubbing of diffs sent to LLM providers.
