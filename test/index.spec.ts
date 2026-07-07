import { Temporal } from "@js-temporal/polyfill";
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("index page returns 200 with TomTom map version from KV", async () => {
  const today = Temporal.Now.plainDateISO("UTC").toString();
  const testVersion = "2024.1";
  const testCheckedAt = Temporal.Now.instant().epochMilliseconds;

  await env.MAP_VERSIONS.put(
    today,
    JSON.stringify({ version: testVersion, checked_at: testCheckedAt }),
  );

  const response = await SELF.fetch("https://example.com/");

  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toContain("TomTom map version");
  expect(text).toContain(testVersion);
});

it("index page falls back gracefully for legacy plain-string KV values", async () => {
  const today = Temporal.Now.plainDateISO("UTC").toString();
  const testVersion = "2023";

  await env.MAP_VERSIONS.put(today, testVersion);

  const response = await SELF.fetch("https://example.com/");

  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toContain(testVersion);
});

it("/v1/current returns epoch ms timestamp in last_checked", async () => {
  const today = Temporal.Now.plainDateISO("UTC").toString();
  const testVersion = "2024.1";
  const testCheckedAt = Temporal.Now.instant().epochMilliseconds;

  await env.MAP_VERSIONS.put(
    today,
    JSON.stringify({ version: testVersion, checked_at: testCheckedAt }),
  );

  const response = await SELF.fetch("https://example.com/v1/current");

  expect(response.status).toBe(200);

  const json = await response.json<{
    current_map_version: string;
    last_checked: number;
  }>();
  expect(json.current_map_version).toBe(testVersion);
  expect(json.last_checked).toBe(testCheckedAt);
});
