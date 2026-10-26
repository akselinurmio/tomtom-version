# CLAUDE.md

## Project overview

TomTom map version checker — a Cloudflare Worker that scrapes the TomTom help page hourly, detects map version changes, stores history in Cloudflare KV, and sends email notifications via Resend when a new version is released.

Live: https://tomtom-version.akseli.workers.dev/

## Architecture

### HTTP routes

- `GET /` — homepage with current version, last check, last change, and release cadence (median gap between releases and an estimated next release date, shown once at least two changes are recorded; computed in `src/cadence.ts` from the change-entry date keys)
- `GET /v1` — API docs
- `GET /v1/current` — JSON: current version + last checked date
- `GET /v1/history` — JSON: full version change history
- `GET /feed.xml` — Atom feed of the change log, newest first, one entry per change. Entry ids are permanent `tag:` URIs built from the change date key (don't change `FEED_ID_PREFIX`, or readers will see every entry as new); `updated` is midnight UTC of that date. Supports conditional requests via Hono's `etag` middleware. HTML pages link to it with `<link rel="alternate">` for autodiscovery. An `<?xml-stylesheet?>` instruction points to `/feed.css`.
- `GET /feed.css` — a bare stylesheet (`FEED_CSS`, no fonts or colors) so a browser shows the raw feed as one title per line with its date, hiding ids, links and the author

All responses allow cross-origin `GET`/`HEAD` (`Access-Control-Allow-Origin: *`). Every response, HTML or JSON and including errors, sends `Cache-Control: public, max-age=60`.

### Scheduled job (hourly)

1. Reads the previous version from the `last_checked` state key
2. Scrapes the TomTom help page (URL from `WEB_PAGE_URL` env var) with a regex to extract the four-digit map version
3. If the version differs from the previous one: records the change and updates the `last_change` pointer
4. Updates `last_checked` with the fetched version and timestamp
5. If the version changed, sends an email notification via Resend

Because `last_checked` always holds the last _successfully_ fetched version, a fetch outage of any length cannot hide a change — when the page recovers the new version is compared against it directly. Likewise, `last_checked` is written only after the change record, so if recording the change fails the next run detects it again rather than losing it.

Fetch/save errors trigger an alert email via `reportError`, throttled to at most one per 24h (tracked via `last_error_alert`) so a sustained outage doesn't send an email every hour.

### KV namespace

A single namespace, `MAP_VERSION_CHANGES`, is the source of truth:

| Key                | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| `<YYYY-MM-DD>`     | A change entry `{ created_at, from_version, to_version }`    |
| `last_change`      | Date-key pointer to the most recent change                   |
| `last_checked`     | Current state `{ version, checked_at }` (updated each run)   |
| `last_error_alert` | Epoch ms of the last error alert email sent (throttle state) |

The current version is `last_checked.version`; there are no per-date version snapshots (they would be redundant — between changes the version is constant and derivable from the change log).

### Secrets (set via Wrangler or Cloudflare dashboard, not in source)

- `RESEND_API_KEY` — Resend API key for email
- `NOTIFY_EMAIL` — recipient address for version change emails

## Testing the scheduled handler locally

Start the dev server with `npm run dev`, then trigger the cron manually:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

Use `npm run setup-mock-kv` to seed local KV with realistic test data first.

## Testing real email delivery

The unit tests mock the Resend API. To test a real send: with `npm run dev` running, seed local KV's `last_checked` with a wrong version (`npx wrangler kv key put --binding=MAP_VERSION_CHANGES --local last_checked '{"version":"0000","checked_at":0}'`), then trigger the cron as above — this fetches the real page and, since the version differs, sends one real email via Resend. There's deliberately no HTTP route for this, so it can't be abused for spam.
