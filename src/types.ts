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
