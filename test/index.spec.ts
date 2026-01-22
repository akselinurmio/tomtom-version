import { Temporal } from "@js-temporal/polyfill";
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("index page returns 200 with TomTom map version from KV", async () => {
  const today = Temporal.Now.plainDateISO("UTC").toString();
  const testVersion = "2024.1";

  await env.MAP_VERSIONS.put(today, testVersion);

  const response = await SELF.fetch("https://example.com/");

  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toContain("TomTom map version");
  expect(text).toContain(testVersion);
});
