// Status is never color alone: every place a status appears pairs the fill
// with one of these distinct glyph shapes (check / triangle / x / dashed
// question mark) so the signal survives colorblindness, grayscale printing,
// and small-cell density alike. See dataviz skill, palette.md's status
// section.

import type { Status } from "../types";
import { STATUS_META, STATUS_TEXT_CLASS } from "../lib/status";

interface StatusIconProps {
  status: Status;
  size?: number;
  className?: string;
}

const commonProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function StatusIcon({ status, size = 14, className }: StatusIconProps) {
  const label = STATUS_META[status].label;
  const props = { ...commonProps, width: size, height: size, className, role: "img" as const, "aria-label": label };

  switch (status) {
    case "green":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5L16 9" />
        </svg>
      );
    case "yellow":
      return (
        <svg {...props}>
          <path d="M12 3.5 21 19.5H3z" strokeLinejoin="round" />
          <line x1="12" y1="9.5" x2="12" y2="13.5" />
          <circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "red":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <line x1="8.8" y1="8.8" x2="15.2" y2="15.2" />
          <line x1="15.2" y1="8.8" x2="8.8" y2="15.2" />
        </svg>
      );
    case "gray":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" strokeDasharray="2.5 2.75" />
          <path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.75.4-1.1.9-1.1 1.8" />
          <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

/** Icon color role each status reads legibly as, when set as the fill of a solid cell/chip. */
export const STATUS_ON_FILL_TEXT_CLASS: Record<Status, string> = {
  green: "text-white",
  yellow: "text-black",
  red: "text-white",
  // gray is deliberately never a solid fill (see StatusCell) — rendered as
  // muted-on-tint instead, so its own token color reads fine.
  gray: "text-status-unknown",
};

interface StatusBadgeProps {
  status: Status;
  size?: "sm" | "md";
  className?: string;
}

/** Icon + word label, for KPI tiles, feature rows, and drawer headers. The
 * label always stays in ink text tokens (never colored) — the icon alone
 * carries the status hue, per the "text never wears the data color" rule. */
export function StatusBadge({ status, size = "md", className = "" }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const iconSize = size === "sm" ? 13 : 15;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`${STATUS_TEXT_CLASS[status]} shrink-0`}>
        <StatusIcon status={status} size={iconSize} />
      </span>
      <span className={`${textSize} font-medium text-ink`}>{meta.label}</span>
    </span>
  );
}

/** Compact icon + raw count, for per-model rollups where four of these sit in a row (label would be too wide). The number stays plain ink — only the icon carries the hue. */
export function StatusCountChip({ status, count }: { status: Status; count: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${STATUS_META[status].label}: ${count}`}>
      <span className={STATUS_TEXT_CLASS[status]}>
        <StatusIcon status={status} size={12} />
      </span>
      <span className="text-xs font-semibold tabular-nums text-ink">{count}</span>
    </span>
  );
}
