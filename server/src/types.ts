export type Status = "green" | "yellow" | "red" | "gray";

export interface CellResult {
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

export interface MarkerResult {
  model: string;
  variable: string;
  cycleId: string;
  present: boolean;
  checkedAt: string;
}

export interface ExtraResult {
  model: string;
  variableId: string;
  note?: string;
}

export interface StatusCounts {
  green: number;
  yellow: number;
  red: number;
  gray: number;
}

export interface RunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  counts: StatusCounts;
}
