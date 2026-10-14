// Click-through detail: fetches /api/cell/:model/:variable/:day and shows
// the exact URL(s) probed, raw HTTP status(es), and timestamp — enough for
// a supervisor to verify or hand off without leaving the dashboard.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCell, errorMessage } from "../api/client";
import type { CellDetail, VariableDetail } from "../types";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/format";
import { StatusBadge, StatusIcon } from "./StatusIcon";

export interface CellSelection {
  modelId: string;
  modelLabel: string;
  variable: VariableDetail;
  day: number;
}

interface CellDrawerProps {
  selection: CellSelection | null;
  onClose: () => void;
}

export function CellDrawer({ selection, onClose }: CellDrawerProps) {
  const [detail, setDetail] = useState<CellDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    setLoading(true);
    getCell(selection.modelId, selection.variable.id, selection.day)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, onClose]);

  if (!selection) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Check detail for ${selection.variable.id}, day ${selection.day}`}
        onClick={(e) => e.stopPropagation()}
        className="animate-drawer-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">
              {selection.modelLabel} · day {selection.day}
            </p>
            <h2 className="truncate text-base font-semibold text-ink">{selection.variable.id}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink/40"
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 px-4 py-4">
          {loading ? (
            <div className="space-y-2" role="status" aria-label="Loading cell detail">
              <div className="h-6 w-32 animate-pulse rounded bg-ink/5" />
              <div className="h-16 animate-pulse rounded bg-ink/5" />
              <div className="h-16 animate-pulse rounded bg-ink/5" />
            </div>
          ) : error ? (
            <div className="rounded-md border border-status-critical/30 bg-status-critical/5 p-3">
              <p className="text-sm text-ink">Couldn't load this check: {error}</p>
              <button
                type="button"
                onClick={() => {
                  // re-trigger the effect by touching selection identity via a manual refetch
                  setError(null);
                  setLoading(true);
                  getCell(selection.modelId, selection.variable.id, selection.day)
                    .then(setDetail)
                    .catch((e: unknown) => setError(errorMessage(e)))
                    .finally(() => setLoading(false));
                }}
                className="mt-2 rounded border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink/5"
              >
                Retry
              </button>
            </div>
          ) : detail ? (
            <>
              <StatusBadge status={detail.status} />

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Checked">
                  <span title={formatAbsoluteTime(detail.checkedAt)}>
                    {formatRelativeTime(detail.checkedAt)}
                  </span>
                </Field>
                {detail.httpStatus !== undefined ? (
                  <Field label="HTTP status">HTTP {detail.httpStatus}</Field>
                ) : null}
                {detail.fallbackHttpStatus !== undefined ? (
                  <Field label="Fallback HTTP status">HTTP {detail.fallbackHttpStatus}</Field>
                ) : null}
              </div>

              {detail.knownGap ? (
                <div className="rounded-md border border-dashed border-ink-muted bg-ink/[0.03] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    Known issue
                  </p>
                  <p className="mt-1 text-sm text-ink">{detail.knownGap}</p>
                </div>
              ) : null}

              {detail.errorMessage ? (
                <div className="rounded-md border border-border bg-ink/[0.03] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    <span className="text-status-unknown">
                      <StatusIcon status="gray" size={12} />
                    </span>
                    Checker error
                  </p>
                  <p className="mt-1 break-words text-sm text-ink">{detail.errorMessage}</p>
                </div>
              ) : null}

              <UrlField label="Checked URL" url={detail.checkedUrl} />
              {detail.fallbackUrl ? <UrlField label="Fallback URL" url={detail.fallbackUrl} /> : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-ink">{children}</p>
    </div>
  );
}

function UrlField({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable/blocked (permissions, insecure context) —
      // the URL is still fully visible and selectable as text below.
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-ink-muted">{label}</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary hover:bg-ink/5"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary hover:bg-ink/5"
          >
            Open ↗
          </a>
        </div>
      </div>
      <p className="break-all rounded-md border border-border bg-ink/[0.03] p-2 font-mono text-xs text-ink">
        {url}
      </p>
    </div>
  );
}
