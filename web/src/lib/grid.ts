// Shapes a variable's sparse `cells` array into a dense day-indexed row for
// the heatmap, distinguishing "never scheduled" (outside startDay/
// dailyRange — not a status at all) from a real result.

import type { CellSummary, ModelDetail, VariableDetail } from "../types";

export type DayCell = CellSummary | null;

/**
 * The full day-column count a model's card should render. `forecastDays` is
 * the model's *inclusive* max day index — not a count — confirmed against
 * the live server: GFS's forecastDays:16 returns cells for days 0..16 (17
 * entries; day 0 is the analysis step, then one checkpoint per day out to
 * 16). So the column count is the widest `forecastDays` among its
 * variables, plus one.
 */
export function modelMaxDays(detail: ModelDetail): number {
  const maxDay = detail.variables.reduce((max, v) => Math.max(max, v.forecastDays), 0);
  return maxDay + 1;
}

/**
 * One entry per day in [0, totalDays). `null` means this day was never part
 * of the variable's promised range (before startDay, or outside
 * dailyRange) — rendered as a blank placeholder, never as gray, because
 * gray specifically means "checked, result unknown."
 *
 * A day that IS inside the promised range but missing from the API's
 * `cells` array (shouldn't normally happen) is treated as an unresolved
 * gray with no timestamp — "we have no result for this," which is exactly
 * gray's own definition, just arrived at from the frontend's side instead
 * of the checker's.
 */
export function buildDayRow(variable: VariableDetail, totalDays: number): DayCell[] {
  const byDay = new Map(variable.cells.map((c) => [c.day, c]));
  const start = variable.startDay ?? 0;
  // Upper bound is inclusive of forecastDays itself — see modelMaxDays above.
  const [rangeStart, rangeEnd] = variable.dailyRange ?? [start, variable.forecastDays];
  const lo = Math.max(start, rangeStart);
  const hi = Math.min(variable.forecastDays, rangeEnd);

  const row: DayCell[] = [];
  for (let day = 0; day < totalDays; day++) {
    if (day < lo || day > hi) {
      row.push(null);
      continue;
    }
    row.push(byDay.get(day) ?? { day, status: "gray", checkedAt: "" });
  }
  return row;
}

export const VARIABLE_KIND_LABEL: Record<VariableDetail["kind"], string> = {
  tile: "tile",
  "wind-json": "wind json",
  "ocean-json": "ocean json",
  "daily-tile": "daily tile",
};
