import { Temporal } from "@js-temporal/polyfill";

export function formatRelativeTime(temporalString: string): string {
  const temporalDate =
    Temporal.Instant.from(temporalString).toZonedDateTimeISO("UTC");
  const now = Temporal.Now.zonedDateTimeISO("UTC");
  const duration = now.since(temporalDate, { smallestUnit: "minutes" });
  const roundedDuration = duration.round({
    largestUnit: "years",
    smallestUnit: "minutes",
    relativeTo: now,
  });

  return roundedDuration.toLocaleString("en", { style: "long" });
}
