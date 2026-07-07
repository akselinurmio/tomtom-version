import { Temporal } from "@js-temporal/polyfill";
import {
  createExecutionContext,
  createScheduledController,
  env,
  fetchMock,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import worker from "../src/index.js";

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

const CRON_SCHEDULE = "0 12 * * *";

function previousCheckDateKey() {
  return Temporal.Now.plainDateISO("UTC").subtract({ days: 1 }).toString();
}

function stubMapVersionPage(version: string) {
  fetchMock
    .get("https://help.tomtom.com")
    .intercept({ path: (path) => path.startsWith("/hc/") })
    .reply(200, `The latest map version is ${version}`);
}

type NotificationEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

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

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
});

it("scheduled job emails a notification when the map version changes", async () => {
  await env.MAP_VERSIONS.put(
    previousCheckDateKey(),
    JSON.stringify({ version: "2024", checked_at: 0 }),
  );
  stubMapVersionPage("2025");
  const captured = captureNotificationEmail();

  await runDailyCheck();

  expect(captured.email).not.toBeNull();
  expect(captured.email!.to).toBe("test@example.com");
  expect(captured.email!.subject).toBe("New TomTom map version available");
  expect(captured.email!.text).toContain("2024");
  expect(captured.email!.text).toContain("2025");
});

it("scheduled job records no change when the map version is unchanged", async () => {
  await env.MAP_VERSIONS.put(
    previousCheckDateKey(),
    JSON.stringify({ version: "2025", checked_at: 0 }),
  );
  stubMapVersionPage("2025");

  await runDailyCheck();

  expect(await env.MAP_VERSION_CHANGES.get("last_change")).toBeNull();
});
