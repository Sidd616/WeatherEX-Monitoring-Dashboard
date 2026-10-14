// Sort/filter logic shared between App (model-card ordering) and ModelCard
// (row ordering within an expanded card) — see FilterBar for the three
// controls this backs.

import type { ModelDetail, ModelSummary, VariableDetail } from "../types";
import { compareSeverity, tallyCells, tallyFromCounts, tallyVariables } from "./status";

export type SortBy = "severity" | "model" | "variable";

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "severity", label: "Severity (worst first)" },
  { value: "model", label: "Model name (A–Z)" },
  { value: "variable", label: "Variable name (A–Z)" },
];

/**
 * Top-level model card order. "severity" ranks by each model's own tally
 * (full detail when loaded, falling back to summary counts — see
 * `tallyFromCounts`); every other option falls back to alphabetical, since
 * "variable name" only has meaning at the row level within a card.
 */
export function compareModels(
  a: ModelSummary,
  b: ModelSummary,
  details: Record<string, ModelDetail | undefined>,
  sortBy: SortBy,
): number {
  if (sortBy === "severity") {
    const da = details[a.id];
    const db = details[b.id];
    const ta = da ? tallyVariables(da.variables) : tallyFromCounts(a.counts);
    const tb = db ? tallyVariables(db.variables) : tallyFromCounts(b.counts);
    return compareSeverity(ta, tb) || a.label.localeCompare(b.label);
  }
  return a.label.localeCompare(b.label);
}

/**
 * Row order within one expanded card. "model" has no row-level meaning, so
 * it keeps the API's own definition order — already a sensible default.
 */
export function sortVariables(variables: VariableDetail[], sortBy: SortBy): VariableDetail[] {
  const copy = [...variables];
  if (sortBy === "severity") {
    copy.sort(
      (a, b) =>
        compareSeverity(
          tallyCells(a.cells, Boolean(a.knownGap)),
          tallyCells(b.cells, Boolean(b.knownGap)),
        ) || a.id.localeCompare(b.id),
    );
  } else if (sortBy === "variable") {
    copy.sort((a, b) => a.id.localeCompare(b.id));
  }
  return copy;
}

export function matchesSearch(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}
