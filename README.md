# TomTom Map Version Checker

Get latest TomTom map version and notify when version changes.

## Overview

Cloudflare Worker that:

- Fetches the latest TomTom map version from their help page
- Stores version data in KV storage
- Sends email notifications when map version changes
- Runs daily at noon UTC via cron trigger

## Deployment

Live at: https://tomtom-version.akseli.workers.dev/

## Development

```bash
npm install
npm run dev
npm run deploy
```
