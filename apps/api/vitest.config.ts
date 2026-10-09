import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: {
        API_TOKEN: "test-only-economic-ledger",
        BUNNY_PULL_ZONE_ID: "12345",
        BUNNY_ACCESS_KEY: "test-only-access-key",
        BUNNY_COLLECT_HOST: "events.example.test",
        BUNNY_SIGNING_KEY: "test-only-trusted-commerce-secret",
      } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
