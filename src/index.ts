import { formatRelativeTime } from "./relative-time.js";
import { formatDateTime } from "./format-datetime.js";

type VersionChange = {
  created_at: number;
  from_version: string;
  to_version: string;
};

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);

    switch (pathname) {
      case "/": {
        const { date, version } = (await getLatestVersion(env)) || {};

        const lastChangeDate = await env.MAP_VERSION_CHANGES.get("last_change");
        const lastChange = lastChangeDate
          ? await env.MAP_VERSION_CHANGES.get<VersionChange>(lastChangeDate, {
              type: "json",
            })
          : null;

        let lastCheckedTime = "";
        if (date) {
          const dateTimeString = `${date}T12:00Z`;
          const formatted = formatRelativeTime(dateTimeString);
          const title = formatDateTime(dateTimeString);
          lastCheckedTime = `<p>Last checked <time datetime="${dateTimeString}" title="${title}">${formatted} ago</time>.</p>`;
        }

        return new Response(
          `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>What is the latest TomTom map version?</title>
<h1>Latest TomTom map version is ${version ?? "currently unknown"}</h1>
${lastCheckedTime}
${
  lastChange && lastChangeDate
    ? (() => {
        const dateBefore = `${getDateOneDayBefore(lastChangeDate)}T12:00Z`;
        const dateAfter = `${lastChangeDate}T12:00Z`;
        const relativeTime = formatRelativeTime(dateAfter);
        const formattedBefore = formatDateTime(dateBefore);
        const formattedAfter = formatDateTime(dateAfter);
        return `<p>Version ${lastChange.to_version} was released ${relativeTime} ago, between <time datetime="${dateBefore}">${formattedBefore}</time> and <time datetime="${dateAfter}">${formattedAfter}</time>. Previous map version was ${lastChange.from_version}.</p>`;
      })()
    : ""
}
<nav>
<p><a href="/v1">JSON API</a></p>
</nav>
</html>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      }

      case "/v1":
        return new Response(
          `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>TomTom Map Version API</title>
<h1>TomTom Map Version API</h1>
<ul>
<li><a href="/v1/current">Current map version</a></li>
<li><a href="/v1/history">Version history</a></li>
</ul>
<nav>
<p><a href="/">Front page</a></p>
</nav>
</html>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );

      case "/v1/current": {
        const versionWithDate: { date: string; version: string } | undefined =
          await getLatestVersion(env);

        return Response.json(
          {
            current_map_version: versionWithDate?.version ?? null,
            last_checked: versionWithDate?.date ?? null,
          },
          { headers: { "Cache-Control": "no-cache" } },
        );
      }

      case "/v1/history": {
        const changes = await env.MAP_VERSION_CHANGES.list<VersionChange>({
          prefix: "2",
        });

        return Response.json(
          {
            version_history: changes.keys.map((entry) => ({
              date: entry.name,
              from_version: entry.metadata?.from_version || null,
              to_version: entry.metadata?.to_version || null,
            })),
          },
          { headers: { "Cache-Control": "no-cache" } },
        );
      }

      default:
        return Response.json(
          { error: "Not found" },
          {
            status: 404,
            headers: { "Cache-Control": "no-cache" },
          },
        );
    }
  },

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
        created_at: Date.now(),
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

  // Remove HTML tags from body
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
  const dateObj = new Date(date || Date.now());
  dateObj.setUTCDate(dateObj.getUTCDate() - 1);
  return dateObj.toISOString().substring(0, 10);
}

function getTodayDate() {
  return new Date().toISOString().substring(0, 10);
}
