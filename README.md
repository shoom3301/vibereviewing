# vibereview

Split a GitHub PR into three layered commits (A/B/C) so reviewers focus on what
needs human judgment.

## Install

```bash
pnpm add -g vibereview
```

Requires Node 20+, `git`, and `gh` CLI (authenticated).

## Quick start

vibereview runs against a local checkout of the **target repo** (the one the PR
lives in), not the directory where vibereview itself is installed. `cd` there
first.

### Using Claude (Anthropic)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd path/to/your/repo
vibereview split https://github.com/owner/repo/pull/1234
```

Override the model:

```bash
vibereview split https://github.com/owner/repo/pull/1234 \
  --provider claude --model claude-opus-4-7
```

### Using OpenAI

```bash
export OPENAI_API_KEY=sk-...
cd path/to/your/repo
vibereview split https://github.com/owner/repo/pull/1234
```

Override the model:

```bash
vibereview split https://github.com/owner/repo/pull/1234 \
  --provider openai --model gpt-5
```

### Provider auto-detection

If both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are set, Claude wins. Pass
`--provider openai` (or `--provider claude`) to force a choice.

### Dry run (no PR, no push)

Inspect the classification manifest without touching git or GitHub:

```bash
vibereview split https://github.com/owner/repo/pull/1234 --dry-run
# or, equivalently:
vibereview manifest https://github.com/owner/repo/pull/1234
```

## Commands

- `vibereview split <pr>` — open a layered companion PR.
- `vibereview manifest <pr>` — print the classification manifest (no git, no PR).
- `vibereview verify <pr>` — re-verify a companion PR (no LLM call).

See `vibereview --help` for flags.

## Configuration

Put a `.vibereview.yml` at the repo root. The most important section is
`floors` — paths in those globs are forced to a minimum layer regardless of
how innocent the hunk looks. Defaults are empty.

See the included example.

## Security

⚠️ vibereview sends your PR diff to the configured LLM provider. If your diff
contains secrets, those secrets are sent to that provider. vibereview does not
scrub secrets in v1.
