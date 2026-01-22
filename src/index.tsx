import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Temporal } from "@js-temporal/polyfill";
import { formatRelativeTime } from "./relative-time.js";
import { formatDateTime } from "./format-datetime.js";

type VersionChange = {
  created_at: number;
  from_version: string;
  to_version: string;
};

const app = new Hono<{ Bindings: Env }>({
  strict: true,
});

const Layout: FC<{ title: string; children?: unknown }> = ({
  title,
  children,
}) => {
  return (
    <>
      {html`<!doctype html>`}
      <html lang="en">
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>{title}</title>
        {children}
      </html>
    </>
  );
};

const HomePage: FC<{
  version?: string;
  lastCheckedDate?: string;
  lastChange?: VersionChange;
  lastChangeDate?: string;
}> = ({ version, lastCheckedDate, lastChange, lastChangeDate }) => {
  return (
    <Layout title="What is the latest TomTom map version?">
      <h1>Latest TomTom map version is {version ?? "currently unknown"}</h1>
      {lastCheckedDate && (
        <p>
          Last checked{" "}
          <time
            datetime={`${lastCheckedDate}T12:00Z`}
            title={formatDateTime(`${lastCheckedDate}T12:00Z`)}
          >
            {formatRelativeTime(`${lastCheckedDate}T12:00Z`)} ago
          </time>
          .
        </p>
      )}
      {lastChange && lastChangeDate && (
        <p>
          Version {lastChange.to_version} was released{" "}
          {formatRelativeTime(`${lastChangeDate}T12:00Z`)} ago, between{" "}
          <time datetime={`${getDateOneDayBefore(lastChangeDate)}T12:00Z`}>
            {formatDateTime(`${getDateOneDayBefore(lastChangeDate)}T12:00Z`)}
          </time>{" "}
          and{" "}
          <time datetime={`${lastChangeDate}T12:00Z`}>
            {formatDateTime(`${lastChangeDate}T12:00Z`)}
          </time>
          . Previous map version was {lastChange.from_version}.
        </p>
      )}
      <nav>
        <p>
          <a href="/v1">JSON API</a>
        </p>
      </nav>
    </Layout>
  );
};

const ApiPage: FC = () => {
  return (
    <Layout title="TomTom Map Version API">
      <h1>TomTom Map Version API</h1>
      <ul>
        <li>
          <a href="/v1/current">Current map version</a>
        </li>
        <li>
          <a href="/v1/history">Version history</a>
        </li>
      </ul>
      <nav>
        <p>
          <a href="/">Front page</a>
        </p>
      </nav>
    </Layout>
  );
};

app.get("/", async (c) => {
  const { date, version } = (await getLatestVersion(c.env)) || {};

  const lastChangeDate = await c.env.MAP_VERSION_CHANGES.get("last_change");
  const lastChange = lastChangeDate
    ? await c.env.MAP_VERSION_CHANGES.get<VersionChange>(lastChangeDate, {
        type: "json",
      })
    : null;

  return c.html(
    <HomePage
      version={version}
      lastCheckedDate={date}
      lastChange={lastChange || undefined}
      lastChangeDate={lastChangeDate || undefined}
    />,
  );
});

app.get("/v1", (c) => {
  return c.html(<ApiPage />);
});

app.get("/v1/current", async (c) => {
  const versionWithDate: { date: string; version: string } | undefined =
    await getLatestVersion(c.env);

  return c.json({
    current_map_version: versionWithDate?.version ?? null,
    last_checked: versionWithDate?.date ?? null,
  });
});

app.get("/v1/history", async (c) => {
  const changes = await c.env.MAP_VERSION_CHANGES.list<VersionChange>({
    prefix: "2",
  });

  return c.json({
    version_history: changes.keys.map((entry) => ({
      date: entry.name,
      from_version: entry.metadata?.from_version || null,
      to_version: entry.metadata?.to_version || null,
    })),
  });
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    let previousVersion: string | null = null;
    try {
      previousVersion = (await getLatestVersion(env))?.version || null;
    } catch (e) {
      console.error("Error occurred while checking previous map version.", e);
    }

    let latestVersion: string;
    try {
      latestVersion = await fetchMapVersion(env);
    } catch (e) {
      console.error(e);

      if (previousVersion) {
        await reportError("Error occurred while checking map version.", e, env);
      }

      throw e;
    }

    try {
      await env.MAP_VERSIONS.put(getTodayDate(), latestVersion);
    } catch (e) {
      console.error(e);
      await reportError("Error occurred while saving map version.", e, env);
      throw e;
    }

    if (!previousVersion) {
      console.log(
        `First time checking map version, latest version is ${latestVersion}`,
      );
    } else if (previousVersion === latestVersion) {
      console.log(
        `Latest map version is the same as in previous check (${latestVersion})`,
      );
    } else {
      const message = `Map version changed from ${previousVersion} to ${latestVersion}`;

      console.log(message);

      const key = getTodayDate();
      const change: VersionChange = {
        created_at: Temporal.Now.instant().epochMilliseconds,
        from_version: previousVersion,
        to_version: latestVersion,
      };

      await env.MAP_VERSION_CHANGES.put(key, JSON.stringify(change), {
        metadata: change,
      });

      await env.MAP_VERSION_CHANGES.put("last_change", key);

      await sendEmail("New TomTom map version available", message, env);
    }
  },
};

async function fetchMapVersion(env: Env): Promise<string> {
  const res = await fetch(env.WEB_PAGE_URL, {
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch map version page, status ${res.status}`);
  }

  let body = await res.text();

  body = body.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s{2,}/g, " ");

  const versionMatch = body.match(/latest map version is (\d{4})/i);

  if (!versionMatch) {
    throw new Error("Failed to find latest map version in page");
  }

  return versionMatch[1];
}

async function getLatestVersion(env: Env) {
  const dates = [getTodayDate(), getDateOneDayBefore()];
  const versionsMap = await env.MAP_VERSIONS.get(dates);

  for (const date of dates) {
    const version = versionsMap.get(date);
    if (version) {
      return { date, version };
    }
  }

  return undefined;
}

async function sendEmail(
  subject: string,
  message: string,
  env: Env,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "TomTom Map version checker <noreply@akselinurmio.fi>",
      to: env.NOTIFY_EMAIL,
      subject: subject,
      text: message,
    }),
  });

  if (!res.ok) {
    console.error(
      `Failed to send notification email, status ${
        res.status
      }: ${await res.text()}`,
    );
    throw new Error("Failed to send notification email");
  }
}

async function reportError(
  message: string,
  exception: unknown,
  env: Env,
): Promise<void> {
  const fullMessage = `${message}\n\n${exception}`;
  await sendEmail("Error in TomTom map version check", fullMessage, env);
}

function getDateOneDayBefore(date?: string) {
  const dateObj = date
    ? Temporal.PlainDate.from(date)
    : Temporal.Now.plainDateISO("UTC");
  return dateObj.subtract({ days: 1 }).toString();
}

function getTodayDate() {
  return Temporal.Now.plainDateISO("UTC").toString();
}
