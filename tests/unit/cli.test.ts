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
