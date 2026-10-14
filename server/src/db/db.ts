// SQLite storage via Node's built-in node:sqlite (no better-sqlite3/native deps). Deliberately
// latest-result-per-key for cells/features/markers (upsert on conflict) — a full per-check
// history table is an explicit fast-follow, not v1 scope. `runs` is the one append-only table:
// a run-level summary log (counts at completion time), used for /api/summary's lastRunAt.
//
// Nothing outside this file should touch SQL directly — only the typed functions below.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { CellResult, FeatureResult, MarkerResult, Status, StatusCounts } from "../types.js";

const DB_PATH = process.env.DB_PATH ?? "./data/monitoring.db";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS cells (
    model TEXT NOT NULL,
    variable TEXT NOT NULL,
    day INTEGER NOT NULL,
    status TEXT NOT NULL,
    checked_url TEXT NOT NULL,
    fallback_url TEXT,
    http_status INTEGER,
    fallback_http_status INTEGER,
    known_gap TEXT,
    checked_at TEXT NOT NULL,
    error_message TEXT,
    PRIMARY KEY (model, variable, day)
  );

  CREATE TABLE IF NOT EXISTS features (
    id TEXT NOT NULL PRIMARY KEY,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    freshness_flag INTEGER,
    known_gap TEXT,
    checked_at TEXT NOT NULL,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS markers (
    model TEXT NOT NULL,
    variable TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    present INTEGER NOT NULL,
    checked_at TEXT NOT NULL,
    PRIMARY KEY (model, variable)
  );

  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT NOT NULL PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    green INTEGER,
    yellow INTEGER,
    red INTEGER,
    gray INTEGER
  );
`);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// node:sqlite's bind parameters accept null | number | bigint | string | ArrayBufferView —
// no boolean. Store booleans as 0/1 and convert at the edges.
function boolToInt(b: boolean | null | undefined): number | null {
  if (b === undefined || b === null) return null;
  return b ? 1 : 0;
}

function intToBoolOrUndefined(v: unknown): boolean | undefined {
  return v === null || v === undefined ? undefined : v === 1;
}

export function emptyCounts(): StatusCounts {
  return { green: 0, yellow: 0, red: 0, gray: 0 };
}

// ---------------------------------------------------------------------------
// cells
// ---------------------------------------------------------------------------

interface CellRow {
  model: string;
  variable: string;
  day: number;
  status: string;
  checked_url: string;
  fallback_url: string | null;
  http_status: number | null;
  fallback_http_status: number | null;
  known_gap: string | null;
  checked_at: string;
  error_message: string | null;
}

function rowToCell(row: CellRow): CellResult {
  return {
    model: row.model,
    variable: row.variable,
    day: row.day,
    status: row.status as Status,
    checkedUrl: row.checked_url,
    fallbackUrl: row.fallback_url ?? undefined,
    httpStatus: row.http_status ?? undefined,
    fallbackHttpStatus: row.fallback_http_status ?? undefined,
    knownGap: row.known_gap ?? undefined,
    checkedAt: row.checked_at,
    errorMessage: row.error_message ?? undefined,
  };
}

const upsertCellStmt = db.prepare(`
  INSERT INTO cells (model, variable, day, status, checked_url, fallback_url, http_status, fallback_http_status, known_gap, checked_at, error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(model, variable, day) DO UPDATE SET
    status = excluded.status,
    checked_url = excluded.checked_url,
    fallback_url = excluded.fallback_url,
    http_status = excluded.http_status,
    fallback_http_status = excluded.fallback_http_status,
    known_gap = excluded.known_gap,
    checked_at = excluded.checked_at,
    error_message = excluded.error_message
`);

export function upsertCell(cell: CellResult): void {
  upsertCellStmt.run(
    cell.model,
    cell.variable,
    cell.day,
    cell.status,
    cell.checkedUrl,
    cell.fallbackUrl ?? null,
    cell.httpStatus ?? null,
    cell.fallbackHttpStatus ?? null,
    cell.knownGap ?? null,
    cell.checkedAt,
    cell.errorMessage ?? null
  );
}

const getCellStmt = db.prepare(`SELECT * FROM cells WHERE model = ? AND variable = ? AND day = ?`);

export function getCell(model: string, variable: string, day: number): CellResult | undefined {
  const row = getCellStmt.get(model, variable, day) as unknown as CellRow | undefined;
  return row ? rowToCell(row) : undefined;
}

const getCellsForVariableStmt = db.prepare(
  `SELECT * FROM cells WHERE model = ? AND variable = ? ORDER BY day ASC`
);

export function getCellsForVariable(model: string, variable: string): CellResult[] {
  const rows = getCellsForVariableStmt.all(model, variable) as unknown as CellRow[];
  return rows.map(rowToCell);
}

const countsByModelStmt = db.prepare(`SELECT model, status, COUNT(*) as n FROM cells GROUP BY model, status`);

export function getCountsByModel(): Record<string, StatusCounts> {
  const rows = countsByModelStmt.all() as unknown as { model: string; status: Status; n: number }[];
  const result: Record<string, StatusCounts> = {};
  for (const row of rows) {
    if (!result[row.model]) result[row.model] = emptyCounts();
    result[row.model][row.status] += Number(row.n);
  }
  return result;
}

export function getOverallCounts(): StatusCounts {
  const byModel = getCountsByModel();
  const total = emptyCounts();
  for (const counts of Object.values(byModel)) {
    total.green += counts.green;
    total.yellow += counts.yellow;
    total.red += counts.red;
    total.gray += counts.gray;
  }
  return total;
}

// ---------------------------------------------------------------------------
// features
// ---------------------------------------------------------------------------

interface FeatureRow {
  id: string;
  label: string;
  status: string;
  http_status: number | null;
  freshness_flag: number | null;
  known_gap: string | null;
  checked_at: string;
  error_message: string | null;
}

function rowToFeature(row: FeatureRow): FeatureResult {
  return {
    id: row.id,
    label: row.label,
    status: row.status as Status,
    httpStatus: row.http_status ?? undefined,
    freshnessFlag: intToBoolOrUndefined(row.freshness_flag),
    knownGap: row.known_gap ?? undefined,
    checkedAt: row.checked_at,
    errorMessage: row.error_message ?? undefined,
  };
}

const upsertFeatureStmt = db.prepare(`
  INSERT INTO features (id, label, status, http_status, freshness_flag, known_gap, checked_at, error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label,
    status = excluded.status,
    http_status = excluded.http_status,
    freshness_flag = excluded.freshness_flag,
    known_gap = excluded.known_gap,
    checked_at = excluded.checked_at,
    error_message = excluded.error_message
`);

export function upsertFeature(feature: FeatureResult): void {
  upsertFeatureStmt.run(
    feature.id,
    feature.label,
    feature.status,
    feature.httpStatus ?? null,
    boolToInt(feature.freshnessFlag),
    feature.knownGap ?? null,
    feature.checkedAt,
    feature.errorMessage ?? null
  );
}

const getAllFeaturesStmt = db.prepare(`SELECT * FROM features ORDER BY id ASC`);

export function getAllFeatures(): FeatureResult[] {
  const rows = getAllFeaturesStmt.all() as unknown as FeatureRow[];
  return rows.map(rowToFeature);
}

// ---------------------------------------------------------------------------
// markers
// ---------------------------------------------------------------------------

interface MarkerRow {
  model: string;
  variable: string;
  cycle_id: string;
  present: number;
  checked_at: string;
}

function rowToMarker(row: MarkerRow): MarkerResult {
  return {
    model: row.model,
    variable: row.variable,
    cycleId: row.cycle_id,
    present: row.present === 1,
    checkedAt: row.checked_at,
  };
}

const upsertMarkerStmt = db.prepare(`
  INSERT INTO markers (model, variable, cycle_id, present, checked_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(model, variable) DO UPDATE SET
    cycle_id = excluded.cycle_id,
    present = excluded.present,
    checked_at = excluded.checked_at
`);

export function upsertMarker(marker: MarkerResult): void {
  upsertMarkerStmt.run(marker.model, marker.variable, marker.cycleId, marker.present ? 1 : 0, marker.checkedAt);
}

const getMarkerStmt = db.prepare(`SELECT * FROM markers WHERE model = ? AND variable = ?`);

export function getMarker(model: string, variable: string): MarkerResult | undefined {
  const row = getMarkerStmt.get(model, variable) as unknown as MarkerRow | undefined;
  return row ? rowToMarker(row) : undefined;
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

const startRunStmt = db.prepare(`INSERT INTO runs (run_id, started_at) VALUES (?, ?)`);

export function startRun(runId: string, startedAt: string): void {
  startRunStmt.run(runId, startedAt);
}

const finishRunStmt = db.prepare(
  `UPDATE runs SET finished_at = ?, green = ?, yellow = ?, red = ?, gray = ? WHERE run_id = ?`
);

export function finishRun(runId: string, finishedAt: string, counts: StatusCounts): void {
  finishRunStmt.run(finishedAt, counts.green, counts.yellow, counts.red, counts.gray, runId);
}

interface RunRow {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  green: number | null;
  yellow: number | null;
  red: number | null;
  gray: number | null;
}

const getLastFinishedRunStmt = db.prepare(
  `SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`
);

export function getLastFinishedRun():
  | { runId: string; startedAt: string; finishedAt: string; counts: StatusCounts }
  | undefined {
  const row = getLastFinishedRunStmt.get() as unknown as RunRow | undefined;
  if (!row || !row.finished_at) return undefined;
  return {
    runId: row.run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: {
      green: row.green ?? 0,
      yellow: row.yellow ?? 0,
      red: row.red ?? 0,
      gray: row.gray ?? 0,
    },
  };
}
