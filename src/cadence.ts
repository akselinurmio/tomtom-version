import { Temporal } from "@js-temporal/polyfill";

export type ReleaseCadence = {
  releaseCount: number;
  averageGapDays: number;
  nextReleaseEstimate: Temporal.PlainDate;
};

/**
 * Estimates release cadence from change dates (YYYY-MM-DD). The next release
 * is expected one average gap after the latest one. Needs at least two
 * releases, since a single release has no gap to measure.
 */
export function computeReleaseCadence(
  changeDates: string[],
): ReleaseCadence | null {
  const dates = changeDates
    .map((date) => Temporal.PlainDate.from(date))
    .sort(Temporal.PlainDate.compare);

  if (dates.length < 2) {
    return null;
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  // The mean of consecutive gaps telescopes to the total span over gap count.
  const totalDays = first.until(last).days;
  const averageGapDays = Math.round(totalDays / (dates.length - 1));

  return {
    releaseCount: dates.length,
    averageGapDays,
    nextReleaseEstimate: last.add({ days: averageGapDays }),
  };
}
