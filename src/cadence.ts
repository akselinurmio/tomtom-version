import { Temporal } from "@js-temporal/polyfill";

export type ReleaseCadence = {
  releaseCount: number;
  medianGapDays: number;
  nextReleaseEstimate: Temporal.PlainDate;
};

/**
 * Estimates release cadence from change dates (YYYY-MM-DD). The next release
 * is expected one median gap after the latest one. The median is used rather
 * than the mean so that an outlier gap, such as one spanning a release the
 * checker missed, doesn't skew the estimate. Needs at least two releases,
 * since a single release has no gap to measure.
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

  const gaps = dates.slice(1).map((date, i) => dates[i].until(date).days);
  const medianGapDays = Math.round(median(gaps));

  return {
    releaseCount: dates.length,
    medianGapDays,
    nextReleaseEstimate: dates[dates.length - 1].add({ days: medianGapDays }),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
