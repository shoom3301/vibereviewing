import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runFixture } from "./runFixture.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, "../fixtures/prs")

describe.each(
  readdirSync(fixturesDir).filter((d) => existsSync(join(fixturesDir, d, "source.diff")))
)(
  "fixture %s",
  (name) => {
    it("matches expected output", async () => {
      const fixtureDir = join(fixturesDir, name)
      const expected = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8"))
      const result = await runFixture(fixtureDir)
      expect(result.integrityOk).toBe(expected.integrityOk)
      expect(result.perLayer).toEqual(expected.perLayer)
    }, 60000)
  },
)
