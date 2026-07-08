import { Temporal } from "@js-temporal/polyfill";
import {
  createExecutionContext,
  createScheduledController,
  env,
  fetchMock,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index.js";

type VersionEntry = {
  version: string;
  checked_at: number;
};

type NotificationEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

const FIXED_NOW_MS = Temporal.Instant.from(
  "2026-01-15T12:00:00Z",
).epochMilliseconds;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CRON_SCHEDULE = "0 12 * * *";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW_MS);
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
  vi.useRealTimers();
});

function seedCurrentState(version: string, checkedAt = 0) {
  return env.MAP_VERSION_CHANGES.put(
    "last_checked",
    JSON.stringify({ version, checked_at: checkedAt } satisfies VersionEntry),
  );
}

function stubMapVersionPage(version: string) {
  fetchMock
    .get("https://help.tomtom.com")
    .intercept({ path: (path) => path.startsWith("/hc/") })
    .reply(200, `The latest map version is ${version}`);
}

function stubMapVersionPageDown() {
  fetchMock
    .get("https://help.tomtom.com")
    .intercept({ path: (path) => path.startsWith("/hc/") })
    .reply(200, "The page is temporarily unavailable");
}

function captureNotificationEmail() {
  const captured: { email: NotificationEmail | null } = { email: null };
  fetchMock
    .get("https://api.resend.com")
    .intercept({ path: "/emails", method: "POST" })
    .reply(200, (request) => {
      captured.email = JSON.parse(request.body as string);
      return { id: "test-id" };
    });
  return captured;
}

async function runDailyCheck() {
  const controller = createScheduledController({ cron: CRON_SCHEDULE });
  const context = createExecutionContext();
  await worker.scheduled(controller, env, context);
  await waitOnExecutionContext(context);
}

it("index page returns 200 with TomTom map version from KV", async () => {
  await seedCurrentState("2024", FIXED_NOW_MS);

  const response = await SELF.fetch("https://example.com/");

  expect(response.status).toBe(200);

  const text = await response.text();
  expect(text).toContain("TomTom map version");
  expect(text).toContain("2024");
});

it("/v1/current returns ISO timestamp in last_checked", async () => {
  const testCheckedAt = FIXED_NOW_MS;
  await seedCurrentState("2024", testCheckedAt);

  const response = await SELF.fetch("https://example.com/v1/current");

  expect(response.status).toBe(200);

  const json = await response.json<{
    current_map_version: string;
    last_checked: string;
  }>();
  expect(json.current_map_version).toBe("2024");
  expect(json.last_checked).toBe("2026-01-15T12:00:00Z");
});

it("/v1/current returns 503 when no version data is available", async () => {
  const response = await SELF.fetch("https://example.com/v1/current");

  expect(response.status).toBe(503);

  const json = await response.json<{ error: string }>();
  expect(json.error).toBeTruthy();
});

it("/v1/current returns 500 with JSON error when KV data is corrupt", async () => {
  await env.MAP_VERSION_CHANGES.put("last_checked", "not valid json");

  const response = await SELF.fetch("https://example.com/v1/current");

  expect(response.status).toBe(500);

  const json = await response.json<{ error: string }>();
  expect(json.error).toBeTruthy();
});

it("scheduled job emails a notification when the map version changes", async () => {
  await seedCurrentState("2024");
  stubMapVersionPage("2025");
  const captured = captureNotificationEmail();

  await runDailyCheck();

  expect(captured.email).not.toBeNull();
  expect(captured.email!.to).toBe("test@example.com");
  expect(captured.email!.subject).toBe("New TomTom map version available");
  expect(captured.email!.text).toContain("2024");
  expect(captured.email!.text).toContain("2025");

  const state = await env.MAP_VERSION_CHANGES.get<VersionEntry>(
    "last_checked",
    {
      type: "json",
    },
  );
  expect(state!.version).toBe("2025");
  expect(await env.MAP_VERSION_CHANGES.get("last_change")).not.toBeNull();
});

it("scheduled job records no change when the map version is unchanged", async () => {
  await seedCurrentState("2025");
  stubMapVersionPage("2025");

  await runDailyCheck();

  expect(await env.MAP_VERSION_CHANGES.get("last_change")).toBeNull();
});

it("scheduled job records no change on the first ever check", async () => {
  stubMapVersionPage("2025");

  await runDailyCheck();

  expect(await env.MAP_VERSION_CHANGES.get("last_change")).toBeNull();
  const state = await env.MAP_VERSION_CHANGES.get<VersionEntry>(
    "last_checked",
    {
      type: "json",
    },
  );
  expect(state!.version).toBe("2025");
});

it("scheduled job survives several consecutive days of the page being down", async () => {
  await seedCurrentState("2024");

  for (let day = 1; day <= 5; day++) {
    vi.setSystemTime(FIXED_NOW_MS + day * ONE_DAY_MS);
    stubMapVersionPageDown();
    const outage = captureNotificationEmail();

    await expect(runDailyCheck()).rejects.toThrow();

    expect(outage.email!.subject).toBe("Error in TomTom map version check");

    const state = await env.MAP_VERSION_CHANGES.get<VersionEntry>(
      "last_checked",
      { type: "json" },
    );
    expect(state!.version).toBe("2024");
    expect(await env.MAP_VERSION_CHANGES.get("last_change")).toBeNull();
  }

  const home = await SELF.fetch("https://example.com/");
  expect(await home.text()).toContain("2024");
  const current = await SELF.fetch("https://example.com/v1/current");
  expect(
    (await current.json<{ current_map_version: string }>()).current_map_version,
  ).toBe("2024");

  vi.setSystemTime(FIXED_NOW_MS + 6 * ONE_DAY_MS);
  stubMapVersionPage("2025");
  const recovery = captureNotificationEmail();

  await runDailyCheck();

  expect(recovery.email!.subject).toBe("New TomTom map version available");
  expect(recovery.email!.text).toContain("2024");
  expect(recovery.email!.text).toContain("2025");

  const state = await env.MAP_VERSION_CHANGES.get<VersionEntry>(
    "last_checked",
    {
      type: "json",
    },
  );
  expect(state!.version).toBe("2025");
  expect(await env.MAP_VERSION_CHANGES.get("last_change")).not.toBeNull();
});
