// Tier 3 — informational only. Collapsed by default, muted throughout, and
// deliberately never status-colored: these were never checked, so painting
// them green/yellow/red/gray would imply a health verdict that doesn't
// exist.

import type { ExtraResult } from "../types";
import { ChevronRightIcon } from "./icons";

interface ExtrasPanelProps {
  data: ExtraResult[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ExtrasPanel({ data, loading, error, onRetry }: ExtrasPanelProps) {
  const grouped = groupByModel(data ?? []);

  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink-secondary hover:text-ink">
        <ChevronRightIcon size={14} className="shrink-0 transition-transform group-open:rotate-90" />
        Pipeline extras (informational){data ? ` — ${data.length} item${data.length === 1 ? "" : "s"}` : ""}
      </summary>
      <div className="border-t border-border px-4 py-3">
        <p className="mb-3 text-xs text-ink-muted">
          Produced by the processing pipeline but not exposed in the product yet. These were never
          health-checked, so — unlike everything else on this page — they're never shown with a
          status color; this list is purely FYI.
        </p>

        {error ? (
          <div className="rounded-md border border-border bg-ink/[0.03] p-3">
            <p className="text-sm text-ink">Couldn't load extras: {error}</p>
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
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-5 w-2/3 animate-pulse rounded bg-ink/5" />
            ))}
          </div>
        ) : grouped.size === 0 ? (
          <p className="text-sm text-ink-muted">No extras reported.</p>
        ) : (
          <div className="space-y-3">
            {[...grouped.entries()].map(([model, items]) => (
              <div key={model}>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{model}</p>
                <ul className="mt-1 space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.variableId}
                      className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-secondary"
                    >
                      <span className="font-medium text-ink">{item.variableId}</span>
                      {item.note ? <span className="text-xs text-ink-muted">{item.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function groupByModel(items: ExtraResult[]): Map<string, ExtraResult[]> {
  const map = new Map<string, ExtraResult[]>();
  for (const item of items) {
    const list = map.get(item.model);
    if (list) list.push(item);
    else map.set(item.model, [item]);
  }
  return map;
}
