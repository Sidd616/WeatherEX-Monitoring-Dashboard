// Top-of-page KPI row: a "handful of headline numbers" per the dataviz
// skill's form heuristic — stat tiles, not a bar/pie chart. Plus last-run
// time and the Run-now control.

import type { Status, SummaryResponse } from "../types";
import { EMPTY_COUNTS, STATUS_BG_SOFT_CLASS, STATUS_META, STATUS_ORDER, STATUS_TEXT_CLASS } from "../lib/status";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/format";
import { StatusIcon } from "./StatusIcon";

interface SummaryBarProps {
  summary: SummaryResponse | null;
  summaryLoading: boolean;
  summaryError: string | null;
  runInProgress: boolean;
  runTriggering: boolean;
  runTriggerError: string | null;
  onRunNow: () => void;
}

export function SummaryBar({
  summary,
  summaryLoading,
  summaryError,
  runInProgress,
  runTriggering,
  runTriggerError,
  onRunNow,
}: SummaryBarProps) {
  const counts = summary?.counts ?? EMPTY_COUNTS;
  const hasEverRun = Boolean(summary?.lastRunAt);
  const busy = runInProgress || runTriggering;
  const stillLoadingFirstSummary = summaryLoading && !summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">WeatherEX Monitoring</h1>
          <p className="text-xs text-ink-muted">
            {summaryError
              ? "Can't reach the monitoring server."
              : stillLoadingFirstSummary
                ? "Loading…"
                : `Last run ${formatRelativeTime(summary?.lastRunAt ?? null)}`}
            {summary?.lastRunAt ? (
              <span className="ml-1" title={formatAbsoluteTime(summary.lastRunAt)}>
                ({formatAbsoluteTime(summary.lastRunAt)})
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {runInProgress ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-status-good" aria-hidden="true" />
              Run in progress…
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRunNow}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runTriggering ? "Starting…" : runInProgress ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {runTriggerError ? (
        <p className="flex items-center gap-1.5 text-xs text-ink">
          <span className="text-status-critical" aria-hidden="true">
            <StatusIcon status="red" size={12} />
          </span>
          {runTriggerError}
        </p>
      ) : null}

      {summaryError ? (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 p-4 text-sm text-ink">
          {summaryError} If it just started, this should resolve on its own within a few seconds.
        </div>
      ) : !hasEverRun && !stillLoadingFirstSummary ? (
        <div className="rounded-lg border border-dashed border-grid bg-surface p-4 text-sm text-ink-muted">
          Waiting for the first sweep to complete — counts will populate here once it finishes.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUS_ORDER.map((s) => (
            <StatTile key={s} status={s} count={counts[s]} loading={stillLoadingFirstSummary} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ status, count, loading }: { status: Status; count: number; loading: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full ${STATUS_BG_SOFT_CLASS[status]} ${STATUS_TEXT_CLASS[status]}`}
        >
          <StatusIcon status={status} size={13} />
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
          {STATUS_META[status].label}
        </span>
      </div>
      <div className="mt-2 text-3xl font-semibold text-ink">
        {loading ? (
          <span className="inline-block h-8 w-12 animate-pulse rounded bg-ink/10 align-middle" />
        ) : (
          count.toLocaleString()
        )}
      </div>
    </div>
  );
}
