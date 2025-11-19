import { Temporal } from "@js-temporal/polyfill";

export function formatDateTime(dateTimeString: string): string {
  const zoned = Temporal.Instant.from(dateTimeString).toZonedDateTimeISO("UTC");

  return zoned.toLocaleString("en", {
    dateStyle: "long",
    timeStyle: "short",
  });
}
