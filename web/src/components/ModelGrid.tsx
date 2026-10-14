// The core view: one ModelCard per model. Owns expand/collapse state —
// cards default collapsed, but a card containing a search match auto-opens
// (manual toggles always win over that heuristic, so a supervisor can still
// collapse a matched card or open an unrelated one while searching).

import { useState } from "react";
import type { ModelDetail, ModelSummary, VariableDetail } from "../types";
import { matchesSearch, type SortBy } from "../lib/filters";
import { ModelCard } from "./ModelCard";

interface ModelGridProps {
  models: ModelSummary[];
  totalModelsCount: number;
  details: Record<string, ModelDetail | undefined>;
  detailErrors: Record<string, string | undefined>;
  loadingDetailIds: Set<string>;
  searchText: string;
  sortBy: SortBy;
  onCellClick: (modelId: string, modelLabel: string, variable: VariableDetail, day: number) => void;
  onRetryDetail: (modelId: string) => void;
  onClearFilters: () => void;
}

export function ModelGrid({
  models,
  totalModelsCount,
  details,
  detailErrors,
  loadingDetailIds,
  searchText,
  sortBy,
  onCellClick,
  onRetryDetail,
  onClearFilters,
}: ModelGridProps) {
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});

  if (totalModelsCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-grid bg-surface p-8 text-center text-sm text-ink-muted">
        No models reported by the server yet.
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-grid bg-surface p-8 text-center text-sm text-ink-muted">
        <p>No models match the current filters.</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 rounded border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink/5"
        >
          Clear filters
        </button>
      </div>
    );
  }

  function autoExpand(model: ModelSummary): boolean {
    if (!searchText.trim()) return false;
    if (matchesSearch(searchText, model.label, model.id)) return true;
    const detail = details[model.id];
    return detail ? detail.variables.some((v) => matchesSearch(searchText, v.id, v.gcsName, v.label)) : false;
  }

  return (
    <div className="space-y-2.5">
      {models.map((model) => {
        const expanded = manualExpanded[model.id] ?? autoExpand(model);
        return (
          <ModelCard
            key={model.id}
            model={model}
            detail={details[model.id]}
            detailError={detailErrors[model.id]}
            detailLoading={loadingDetailIds.has(model.id)}
            expanded={expanded}
            onToggleExpand={() =>
              setManualExpanded((prev) => ({ ...prev, [model.id]: !expanded }))
            }
            searchText={searchText}
            sortBy={sortBy}
            onCellClick={onCellClick}
            onRetryDetail={() => onRetryDetail(model.id)}
          />
        );
      })}
    </div>
  );
}
