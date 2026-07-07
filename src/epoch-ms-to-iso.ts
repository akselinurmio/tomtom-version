import { Temporal } from "@js-temporal/polyfill";

export function epochMsToIso(ms: number): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toString({
    smallestUnit: "minute",
  });
}
