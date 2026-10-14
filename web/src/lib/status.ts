// Pure status logic shared across the grid, summary bar, and filters: no
// JSX here on purpose, so App.tsx and friends can pull in tallying/sorting
// without dragging a component import along.

import type { CellSummary, Status, StatusCounts, VariableDetail } from "../types";

export const STATUS_ORDER: Status[] = ["red", "gray", "yellow", "green"];

export const STATUS_META: Record<
  Status,
  { label: string; short: string; description: string }
> = {
  green: {
    label: "Green",
    short: "OK",
    description: "Working normally.",
  },
  yellow: {
    label: "Yellow",
    short: "Degraded",
    description: "Working, but only because a fallback path kicked in.",
  },
  red: {
    label: "Red",
    short: "Broken",
    description: "Broken — the fallback failed too (or doesn't exist).",
  },
  gray: {
    label: "Gray",
    short: "Unknown",
    description:
      "The check itself couldn't complete (network/timeout) — not confirmed broken.",
  },
};

/**
 * The CSS/Tailwind tokens (from the dataviz skill's palette.md) are named by
 * severity role — good/warning/critical/unknown — while the API's `Status`
 * union is named by color — green/yellow/red/gray. Tailwind's scanner needs
 * whole, literal class-name strings in source (a template literal like
 * `text-status-${x}` is invisible to it), so every class name the app needs
 * is spelled out in full here, once, instead of built ad hoc per component.
 */
export const STATUS_TEXT_CLASS: Record<Status, string> = {
  green: "text-status-good",
  yellow: "text-status-warning",
  red: "text-status-critical",
  gray: "text-status-unknown",
};

export const STATUS_BG_CLASS: Record<Status, string> = {
  green: "bg-status-good",
  yellow: "bg-status-warning",
  red: "bg-status-critical",
  gray: "bg-status-unknown",
};

/** Soft/tinted background (12% mix), for chips and row accents that shouldn't read as a full saturated block. */
export const STATUS_BG_SOFT_CLASS: Record<Status, string> = {
  green: "bg-status-good/12",
  yellow: "bg-status-warning/15",
  red: "bg-status-critical/12",
  gray: "bg-status-unknown/12",
};

export const EMPTY_COUNTS: StatusCounts = { green: 0, yellow: 0, red: 0, gray: 0 };

/**
 * "Worst-first" priority used for sorting. Red (confirmed broken) is worst;
 * gray (unknown / needs a re-check) ranks above yellow because it may be
 * hiding a real problem the checker just couldn't confirm either way;
 * yellow (degraded but working) outranks green only because it's at least
 * worth a glance. Green is always least urgent.
 */
export interface SeverityTally {
  /** Red cells on rows/models with NO knownGap — i.e. newly-broken, not a documented landmine. */
  newRed: number;
  red: number;
  gray: number;
  yellow: number;
  green: number;
}

export const ZERO_TALLY: SeverityTally = { newRed: 0, red: 0, gray: 0, yellow: 0, green: 0 };

export function tallyCells(cells: CellSummary[], knownGap: boolean): SeverityTally {
  const t: SeverityTally = { newRed: 0, red: 0, gray: 0, yellow: 0, green: 0 };
  for (const c of cells) {
    if (c.status === "red") {
      t.red++;
      if (!knownGap) t.newRed++;
    } else if (c.status === "gray") t.gray++;
    else if (c.status === "yellow") t.yellow++;
    else t.green++;
  }
  return t;
}

export function tallyVariables(variables: VariableDetail[]): SeverityTally {
  let acc = ZERO_TALLY;
  for (const v of variables) {
    acc = combineTally(acc, tallyCells(v.cells, Boolean(v.knownGap)));
  }
  return acc;
}

export function combineTally(a: SeverityTally, b: SeverityTally): SeverityTally {
  return {
    newRed: a.newRed + b.newRed,
    red: a.red + b.red,
    gray: a.gray + b.gray,
    yellow: a.yellow + b.yellow,
    green: a.green + b.green,
  };
}

/** Fallback when full detail hasn't loaded yet: treats every red as "new" (never hides a real problem, only over-surfaces it). */
export function tallyFromCounts(counts: StatusCounts): SeverityTally {
  return {
    newRed: counts.red,
    red: counts.red,
    gray: counts.gray,
    yellow: counts.yellow,
    green: counts.green,
  };
}

/** Worst-first comparator: most new-red first, then most red, then gray, then yellow; fewer green last (more problems first). */
export function compareSeverity(a: SeverityTally, b: SeverityTally): number {
  return (
    b.newRed - a.newRed ||
    b.red - a.red ||
    b.gray - a.gray ||
    b.yellow - a.yellow ||
    a.green - b.green
  );
}

