// Tier 2 — platform features. Not day-indexed, so a table (not a heatmap):
// per the dataviz skill's form heuristic, tabular data with a handful of
// named fields per row is exactly what a table is for.

import type { FeaturesResponse } from "../types";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/format";
import { StatusBadge } from "./StatusIcon";

interface FeaturePanelProps {
  data: FeaturesResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function FeaturePanel({ data, loading, error, onRetry }: FeaturePanelProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Platform features</h2>
        {data?.checkedAt ? (
          <span className="text-xs text-ink-muted" title={formatAbsoluteTime(data.checkedAt)}>
            checked {formatRelativeTime(data.checkedAt)}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 p-4">
          <p className="text-sm text-ink">Couldn't load feature checks: {error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink/5"
          >
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-ink/5" />
          ))}
        </div>
      ) : !data || data.features.length === 0 ? (
        <div className="rounded-lg border border-dashed border-grid bg-surface p-6 text-center text-sm text-ink-muted">
          No feature checks reported yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-3 py-2 font-medium">Feature</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Freshness</th>
                <th className="px-3 py-2 font-medium">HTTP</th>
                <th className="px-3 py-2 font-medium">Checked</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{f.label}</span>
                      {f.knownGap ? (
                        <span
                          className="rounded border border-dashed border-ink-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary"
                          title={f.knownGap}
                        >
                          Known issue
                        </span>
                      ) : null}
                    </div>
                    {f.knownGap ? (
                      <p className="mt-0.5 max-w-xs truncate text-xs italic text-ink-muted" title={f.knownGap}>
                        {f.knownGap}
                      </p>
                    ) : null}
                    {f.errorMessage ? (
                      <p className="mt-0.5 max-w-xs truncate text-xs text-ink-muted" title={f.errorMessage}>
                        {f.errorMessage}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <StatusBadge status={f.status} size="sm" />
                  </td>
                  <td className="px-3 py-2.5 align-top text-ink-secondary">
                    {f.freshnessFlag === undefined ? "—" : f.freshnessFlag ? "stale" : "fresh"}
                  </td>
                  <td className="px-3 py-2.5 align-top text-ink-secondary">{f.httpStatus ?? "—"}</td>
                  <td
                    className="px-3 py-2.5 align-top text-ink-secondary"
                    title={formatAbsoluteTime(f.checkedAt)}
                  >
                    {formatRelativeTime(f.checkedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
