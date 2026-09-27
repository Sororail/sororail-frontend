"use client";

/**
 * A schedule drawn as a schedule.
 *
 * Streams and vesting are defined by *when* things happen, so a progress bar
 * is the wrong picture: it collapses a cliff date, an end date and today into
 * a single percentage. This keeps the dates and marks the events on a real
 * time axis.
 */

export interface ScheduleMark {
  /** Ledger timestamp, seconds. */
  at: bigint;
  label: string;
}

function formatDate(seconds: bigint): string {
  const ms = Number(seconds % 1_000_000_000n) * 1000;
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function percent(value: bigint, start: bigint, end: bigint): number {
  const span = end - start;
  if (span <= 0n) return 0;
  const offset = value - start;
  if (offset < 0n) return 0;
  if (offset > span) return 100;
  // Scale before converting so precision survives large timestamps.
  return Number((offset * 10_000n) / span) / 100;
}

export function Schedule({
  start,
  end,
  now,
  marks = [],
}: {
  start: bigint;
  end: bigint;
  /** Ledger time as the app understands it. */
  now: bigint;
  marks?: ScheduleMark[];
}) {
  const elapsed = percent(now, start, end);
  const sortedMarks = [...marks].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  );

  return (
    <div>
      <div className="schedule">
        <div
          className="schedule__filled"
          style={{ width: `${elapsed}%` }}
          role="progressbar"
          aria-valuenow={elapsed}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Schedule progress"
          aria-valuetext={`${elapsed}% through schedule`}
        />
        {sortedMarks.map((mark) => {
          const at = percent(mark.at, start, end);
          return (
            <div
              key={`${mark.label}-${mark.at}`}
              className="schedule__mark"
              style={{ left: `${at}%` }}
              role="img"
              aria-label={`${mark.label} marker at ${formatDate(mark.at)}`}
            >
              <span className="schedule__mark-label" aria-hidden="true">
                {mark.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="schedule-axis">
        <span>{formatDate(start)}</span>
        <span>
          {now < end ? `now · ${formatDate(now)}` : `ended ${formatDate(end)}`}
        </span>
        <span>{formatDate(end)}</span>
      </div>
    </div>
  );
}

/** A date and the time remaining to it, stated rather than implied. */
export function WhenLabel({ at, now }: { at: bigint; now: bigint }) {
  const seconds = Number(at - now);
  const absolute = new Date(Number(at) * 1000).toLocaleString();

  if (seconds <= 0) return <span title={absolute}>{absolute}</span>;

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  const relative =
    days > 0
      ? `in ${days}d ${hours}h`
      : hours > 0
        ? `in ${hours}h ${minutes}m`
        : minutes > 0
          ? `in ${minutes}m`
          : `in <1m`;

  return <span title={absolute}>{relative}</span>;
}
