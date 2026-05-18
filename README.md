# vibereview

Split a GitHub PR into three layered commits (A/B/C) so reviewers focus on what
needs human judgment.

## Install

```bash
pnpm add -g vibereview
```

Requires Node 20+, `git`, and `gh` CLI (authenticated).

## Quick start

```bash
export ANTHROPIC_API_KEY=sk-...
cd path/to/your/repo
vibereview split https://github.com/owner/repo/pull/1234
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
