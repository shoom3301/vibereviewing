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
