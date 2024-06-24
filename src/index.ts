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
      case "/":
        return new Response(null, {
          status: 301,
          headers: {
            Location: "/v1",
            "Cache-Control": "no-cache",
          },
        });

      case "/v1":
        return new Response(
          `<!doctype html>
<meta charset="utf-8">
<title>TomTom Map Version</title>
<h1>TomTom Map Version</h1>
<ul>
<li><a href="/v1/current">Current map version</a></li>
<li><a href="/v1/history">Version history</a></li>
</ul>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );

      case "/current":
        return new Response(null, {
          status: 301,
          headers: {
            Location: "/v1/current",
            "Cache-Control": "no-cache",
          },
        });

      case "/v1/current": {
        const versionWithDate: { date: string; version: string } | undefined =
          await (async () => {
            const shouldTodaysVersionBeChecked = new Date().getUTCHours() >= 12;

            if (shouldTodaysVersionBeChecked) {
              const today = getTodayDate();
              const todaysVersion = await env.map_versions.get(today);
              if (todaysVersion) return { date: today, version: todaysVersion };
            }

            const yesterday = getYesterdayDate();
            const yesterdaysVersion = await env.map_versions.get(yesterday);
            if (yesterdaysVersion)
              return { date: yesterday, version: yesterdaysVersion };
          })();

        return Response.json(
          {
            current_map_version: versionWithDate?.version ?? null,
            last_checked: versionWithDate?.date ?? null,
          },
          { headers: { "Cache-Control": "no-cache" } },
        );
      }

      case "/v1/history": {
        const changes = await env.map_version_changes.list<VersionChange>();

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
      previousVersion =
        (await env.map_versions.get(getTodayDate())) ||
        (await env.map_versions.get(getYesterdayDate()));
    } catch (e) {
      console.error("Error occurred while checking previous map version.", e);
    }

    let latestVersion: string;
    try {
      latestVersion = await fetchMapVersion(env);
    } catch (e) {
      console.error(e);

      if (previousVersion) {
        await reportError(
          `Error occurred while checking map version. ${e}`,
          env,
        );
      }

      throw e;
    }

    try {
      await env.map_versions.put(getTodayDate(), latestVersion);
    } catch (e) {
      console.error(e);
      await reportError(`Error occurred while saving map version. ${e}`, env);
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

      const change: VersionChange = {
        created_at: Date.now(),
        from_version: previousVersion,
        to_version: latestVersion,
      };

      await env.map_version_changes.put(
        getTodayDate(),
        JSON.stringify(change),
        { metadata: change },
      );

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

async function sendEmail(
  subject: string,
  message: string,
  env: Env,
): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: "noreply@akselinurmio.fi" },
      subject: subject,
      personalizations: [{ to: [{ email: env.NOTIFY_EMAIL }] }],
      content: [{ type: "text/plain", value: message }],
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

async function reportError(message: unknown, env: Env): Promise<void> {
  await sendEmail("Error in TomTom map version check", String(message), env);
}

function getYesterdayDate() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().substring(0, 10);
}

function getTodayDate() {
  return new Date().toISOString().substring(0, 10);
}
