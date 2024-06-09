export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const { pathname } = new URL(request.url);

    switch (pathname) {
      case "/current": {
        const latest =
          (
            await Promise.all([
              env.map_versions.get(getTodayDate()),
              env.map_versions.get(getYesterdayDate()),
            ])
          ).find((v) => v) || null;

        return Response.json({
          current_map_version: latest,
        });
      }
      default:
        return Response.json({ error: "Not found" }, { status: 404 });
    }
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    let previousVersion: string | null = null;
    try {
      previousVersion = await env.map_versions.get(getYesterdayDate());
    } catch (e) {
      console.error("Error occurred while checking previous map version.", e);
    }

    let latestVersion: string;
    try {
      latestVersion = await fetchMapVersion(env);
    } catch (e) {
      console.error(e);

      if (previousVersion)
        await reportError(
          `Error occurred while checking map version. ${e}`,
          env
        );

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
        `First time checking map version, latest version is ${latestVersion}`
      );
    } else if (previousVersion === latestVersion) {
      console.log(
        `Latest map version is the same as yesterday (${latestVersion})`
      );
    } else {
      const message = `Map version changed from ${previousVersion} to ${latestVersion}`;

      console.log(message);

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
  body = body.replaceAll(/<[^>]+>/g, " ");

  const versionMatch = body.match(/latest\s+map\s+version\s+is\s*(\d{4})/i);

  if (!versionMatch) {
    throw new Error("Failed to find latest map version in page");
  }

  return versionMatch[1];
}

async function sendEmail(
  subject: string,
  message: string,
  env: Env
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
      }: ${await res.text()}`
    );
    throw new Error("Failed to send notification email");
  }
}

async function reportError(message: unknown, env: Env): Promise<void> {
  await sendEmail("Error in TomTom map version check", String(message), env);
}

function getYesterdayDate(now = new Date()) {
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  return yesterday.toISOString().substring(0, 10);
}

function getTodayDate(now = new Date()) {
  return now.toISOString().substring(0, 10);
}
