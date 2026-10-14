// Mirrors the REST contract exposed by `server/`. Kept deliberately
// self-contained (no shared package) per the build spec — this is the
// frontend's own source of truth for shapes coming over the wire.

export type Status = "green" | "yellow" | "red" | "gray";

export interface StatusCounts {
  green: number;
  yellow: number;
  red: number;
  gray: number;
}

// ---- GET /api/summary ----

export interface ModelSummary {
  id: string;
  label: string;
  counts: StatusCounts;
}

export interface SummaryResponse {
  lastRunAt: string | null;
  runInProgress: boolean;
  counts: StatusCounts;
  models: ModelSummary[];
}

// ---- GET /api/models/:model ----

export type VariableKind = "tile" | "wind-json" | "ocean-json" | "daily-tile";

export interface CellSummary {
  day: number;
  status: Status;
  checkedAt: string;
}

export interface VariableDetail {
  id: string;
  /** Human-facing override when it differs from `id` (e.g. wind altitude levels are shown by
   * pressure, matching platform-frontend, while `id` stays the real meter-based GCS key). */
  label?: string;
  kind: VariableKind;
  gcsName?: string;
  forecastDays: number;
  startDay?: number;
  dailyRange?: [number, number];
  knownGap?: string;
  note?: string;
  markerPresent: boolean | null;
  cells: CellSummary[];
}

export interface ModelDetail {
  id: string;
  label: string;
  note?: string;
  variables: VariableDetail[];
}

// ---- GET /api/cell/:model/:variable/:day ----

export interface CellDetail {
  model: string;
  variable: string;
  day: number;
  status: Status;
  checkedUrl: string;
  fallbackUrl?: string;
  httpStatus?: number;
  fallbackHttpStatus?: number;
  knownGap?: string;
  checkedAt: string;
  errorMessage?: string;
}

// ---- GET /api/features ----

export interface FeatureResult {
  id: string;
  label: string;
  status: Status;
  httpStatus?: number;
  freshnessFlag?: boolean;
  knownGap?: string;
  checkedAt: string;
  errorMessage?: string;
}

export interface FeaturesResponse {
  checkedAt: string | null;
  features: FeatureResult[];
}

// ---- GET /api/extras ----

export interface ExtraResult {
  model: string;
  variableId: string;
  note?: string;
}

// ---- POST /api/run, GET /api/run/status ----

export interface RunResponse {
  started: boolean;
  runId?: string;
  reason?: string;
}

export interface RunStatusResponse {
  runInProgress: boolean;
  lastRunAt: string | null;
}
