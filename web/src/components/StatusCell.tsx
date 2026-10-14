// One cell in the variable × day heatmap. A real hit target (button, not a
// decorative pixel) with a hover/focus tooltip — per the dataviz skill,
// tooltips enhance but never gate: the same info is also one click away in
// the CellDrawer, and keyboard focus shows the identical tooltip via
// `group-focus-within`.

import type { Status } from "../types";
import { STATUS_BG_CLASS, STATUS_META } from "../lib/status";
import { STATUS_ON_FILL_TEXT_CLASS, StatusIcon } from "./StatusIcon";
import { formatRelativeTime } from "../lib/format";

interface StatusCellProps {
  status: Status | null;
  day: number;
  variableLabel: string;
  checkedAt?: string;
  knownGap?: string;
  onClick?: () => void;
}

export function StatusCell({
  status,
  day,
  variableLabel,
  checkedAt,
  knownGap,
  onClick,
}: StatusCellProps) {
  if (status === null) {
    // Not scheduled for this day at all (outside the variable's startDay /
    // dailyRange) — deliberately not gray: gray means "checked, unknown
    // result"; this cell was never a check in the first place.
    return (
      <div
        className="flex h-9 w-full items-center justify-center rounded border border-dashed border-grid text-ink-muted"
        title={`${variableLabel} · day ${day} · not part of this variable's schedule`}
        aria-hidden="true"
      >
        <span className="text-xs">–</span>
      </div>
    );
  }

  const meta = STATUS_META[status];
  const tooltip = [
    variableLabel,
    `day ${day}`,
    `${meta.label} — ${meta.description}`,
    checkedAt ? `checked ${formatRelativeTime(checkedAt)}` : null,
    knownGap ? `known issue: ${knownGap}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const isGray = status === "gray";

  return (
    <div className="group relative h-9">
      <button
        type="button"
        onClick={onClick}
        className={[
          "flex h-9 w-full items-center justify-center rounded transition-transform",
          "hover:scale-[1.08] hover:shadow-sm focus-visible:scale-[1.08]",
          "outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ink/40",
          isGray
            ? "border border-dashed border-status-unknown bg-status-unknown/10"
            : `border border-transparent ${STATUS_BG_CLASS[status]}`,
        ].join(" ")}
        aria-label={tooltip}
      >
        <span className={isGray ? "text-status-unknown" : STATUS_ON_FILL_TEXT_CLASS[status]}>
          <StatusIcon status={status} size={14} />
        </span>
        {knownGap ? (
          <span
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-ink-muted ring-1 ring-surface"
            aria-hidden="true"
          />
        ) : null}
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-64 -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-ink shadow-lg group-hover:block group-focus-within:block"
      >
        {tooltip}
      </div>
    </div>
  );
}
