import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          bindings: {
            RESEND_API_KEY: "test-key",
            NOTIFY_EMAIL: "test@example.com",
          },
        },
      },
    },
  },
});
