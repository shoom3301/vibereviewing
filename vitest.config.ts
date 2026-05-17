import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: { provider: "v8", reporter: ["text", "html"] },
    testTimeout: 10000,
  },
})
