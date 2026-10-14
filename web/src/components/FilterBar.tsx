// One row, above the content, per the dataviz skill's interaction rules —
// never per-chart filters. Three controls: which model to isolate, how to
// order models/rows, and free-text search across model + variable names.

import { SORT_OPTIONS, type SortBy } from "../lib/filters";

interface FilterBarProps {
  modelOptions: { id: string; label: string }[];
  modelFilter: string;
  onModelFilterChange: (value: string) => void;
  sortBy: SortBy;
  onSortByChange: (value: SortBy) => void;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onClear: () => void;
  isFiltered: boolean;
}

export function FilterBar({
  modelOptions,
  modelFilter,
  onModelFilterChange,
  sortBy,
  onSortByChange,
  searchText,
  onSearchTextChange,
  onClear,
  isFiltered,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor="filter-model" className="text-xs font-medium text-ink-secondary">
          Model
        </label>
        <select
          id="filter-model"
          value={modelFilter}
          onChange={(e) => onModelFilterChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          <option value="all">All models</option>
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="filter-sort" className="text-xs font-medium text-ink-secondary">
          Sort
        </label>
        <select
          id="filter-sort"
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value as SortBy)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-48 flex-1 items-center gap-1.5">
        <label htmlFor="filter-search" className="text-xs font-medium text-ink-secondary">
          Search
        </label>
        <input
          id="filter-search"
          type="search"
          value={searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          placeholder="model or variable name…"
          className="w-full min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-ink/40"
        />
      </div>

      {isFiltered ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-1 text-xs font-medium text-ink-secondary hover:bg-ink/5 hover:text-ink"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
