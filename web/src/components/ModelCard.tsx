// One model's expandable card: collapsed header shows the rollup + model
// note; expanded body is the variable × day heatmap. The single biggest
// information-density surface in the app, per the build spec.

import { Fragment } from "react";
import type { ModelDetail, ModelSummary, VariableDetail } from "../types";
import { STATUS_ORDER } from "../lib/status";
import { matchesSearch, sortVariables, type SortBy } from "../lib/filters";
import { buildDayRow, modelMaxDays, VARIABLE_KIND_LABEL } from "../lib/grid";
import { StatusCountChip } from "./StatusIcon";
import { StatusCell } from "./StatusCell";
import { ChevronRightIcon } from "./icons";

interface ModelCardProps {
  model: ModelSummary;
  detail: ModelDetail | undefined;
  detailError: string | undefined;
  detailLoading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  searchText: string;
  sortBy: SortBy;
  onCellClick: (modelId: string, modelLabel: string, variable: VariableDetail, day: number) => void;
  onRetryDetail: () => void;
}

export function ModelCard({
  model,
  detail,
  detailError,
  detailLoading,
  expanded,
  onToggleExpand,
  searchText,
  sortBy,
  onCellClick,
  onRetryDetail,
}: ModelCardProps) {
  const totalDays = detail ? modelMaxDays(detail) : 0;
  const modelLevelMatch = matchesSearch(searchText, model.label, model.id);
  const rows = detail ? sortVariables(detail.variables, sortBy) : [];
  const visibleRows = rows.filter(
    (v) => modelLevelMatch || matchesSearch(searchText, v.id, v.gcsName, v.label),
  );

  return (
    <section className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink/40"
      >
        <ChevronRightIcon
          size={16}
          className={`mt-1 shrink-0 text-ink-muted transition-transform ${expanded ? "rotate-90" : ""}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-ink">{model.label}</h3>
            <div className="flex items-center gap-3">
              {STATUS_ORDER.map((s) => (
                <StatusCountChip key={s} status={s} count={model.counts[s]} />
              ))}
            </div>
          </div>
          {detail?.note ? (
            <p className="mt-1 text-xs text-ink-secondary">{detail.note}</p>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border px-4 py-3">
          {detailError ? (
            <div className="rounded-md border border-status-critical/30 bg-status-critical/5 p-3">
              <p className="text-sm text-ink">Couldn't load this model's detail: {detailError}</p>
              <button
                type="button"
                onClick={onRetryDetail}
                className="mt-2 rounded border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink/5"
              >
                Retry
              </button>
            </div>
          ) : !detail ? (
            <div className="space-y-1.5" aria-label="Loading model detail" role="status">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-ink/5" />
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="py-4 text-sm text-ink-muted">
              {detailLoading ? "Loading…" : "No variables match the current filters."}
            </p>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div
                className="grid min-w-max gap-1"
                style={{
                  gridTemplateColumns: `minmax(210px, 260px) repeat(${totalDays}, minmax(30px, 1fr))`,
                }}
              >
                <div />
                {Array.from({ length: totalDays }, (_, day) => (
                  <div
                    key={`day-${day}`}
                    className="flex items-center justify-center text-[11px] font-medium text-ink-muted"
                    title={`Day ${day}`}
                  >
                    {day}
                  </div>
                ))}

                {visibleRows.map((variable) => {
                  const dayRow = buildDayRow(variable, totalDays);
                  return (
                    <Fragment key={variable.id}>
                      <VariableLabel variable={variable} />
                      {dayRow.map((cell, day) => (
                        <StatusCell
                          key={day}
                          status={cell?.status ?? null}
                          day={day}
                          variableLabel={variable.id}
                          checkedAt={cell?.checkedAt}
                          knownGap={variable.knownGap}
                          onClick={
                            cell ? () => onCellClick(model.id, model.label, variable, day) : undefined
                          }
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function VariableLabel({ variable }: { variable: VariableDetail }) {
  const hasOverride = Boolean(variable.label && variable.label !== variable.id);
  const hints: string[] = [];
  if (hasOverride) hints.push(`id: ${variable.id}`);
  if (variable.gcsName && variable.gcsName !== variable.id) hints.push(`gcs: ${variable.gcsName}`);
  if (variable.startDay) hints.push(`from day ${variable.startDay}`);
  if (variable.dailyRange) hints.push(`days ${variable.dailyRange[0]}–${variable.dailyRange[1]}`);
  if (variable.markerPresent !== null) hints.push(`marker: ${variable.markerPresent ? "yes" : "no"}`);

  return (
    <div className="flex flex-col justify-center gap-0.5 py-1 pr-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-ink">{variable.label ?? variable.id}</span>
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
          {VARIABLE_KIND_LABEL[variable.kind]}
        </span>
        {variable.knownGap ? (
          <span
            className="rounded border border-dashed border-ink-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary"
            title={variable.knownGap}
          >
            Known issue
          </span>
        ) : null}
      </div>
      {hints.length > 0 ? (
        <div className="flex flex-wrap gap-x-2 text-[11px] text-ink-muted">
          {hints.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      ) : null}
      {variable.knownGap ? (
        <p className="max-w-sm truncate text-[11px] italic text-ink-muted" title={variable.knownGap}>
          {variable.knownGap}
        </p>
      ) : variable.note ? (
        <p className="max-w-sm truncate text-[11px] text-ink-muted" title={variable.note}>
          {variable.note}
        </p>
      ) : null}
    </div>
  );
}
