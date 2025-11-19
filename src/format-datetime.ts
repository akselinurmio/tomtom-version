import { Temporal } from "@js-temporal/polyfill";

export function formatDateTime(dateTimeString: string): string {
  const zoned = Temporal.Instant.from(dateTimeString).toZonedDateTimeISO("UTC");

  return zoned.toLocaleString("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    timeZoneName: "short",
  });
}
