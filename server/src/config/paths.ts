import type { ModelDef, VariableDef } from "./models.js";

export const TILE_BUCKET = "weather-tiles";
export const TILE_PUBLIC_BASE = `https://storage.googleapis.com/${TILE_BUCKET}`;

export interface Cycle {
  /** YYYYMMDD, UTC. */
  date: string;
  hour: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export function toYYYYMMDD(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

function addDaysUTC(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * The cycle we'd expect to be live right now, mirroring platform-api-server's
 * get_latest_<model>_cycle() lag logic: walk today's cycle hours newest-first,
 * pick the first one that's had `availabilityLagHours` to finish; if none of
 * today's have, fall back to yesterday's newest cycle hour.
 */
export function latestCycle(model: ModelDef, now: Date = new Date()): Cycle {
  const today = toYYYYMMDD(now);
  for (const hour of model.cycleHours) {
    const cycleStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0)
    );
    const readyAt = cycleStart.getTime() + model.availabilityLagHours * 3600_000;
    if (readyAt <= now.getTime()) {
      return { date: today, hour };
    }
  }
  const yesterday = toYYYYMMDD(addDaysUTC(now, -1));
  return { date: yesterday, hour: model.cycleHours[0] };
}

/**
 * The backend's own fallback shift: same nominal cycle hour, previous day, and
 * the caller adds 24 to the forecast hour it was already asking for.
 */
export function fallbackCycle(cycle: Cycle): Cycle {
  const asDate = new Date(
    Date.UTC(Number(cycle.date.slice(0, 4)), Number(cycle.date.slice(4, 6)) - 1, Number(cycle.date.slice(6, 8)))
  );
  return { date: toYYYYMMDD(addDaysUTC(asDate, -1)), hour: cycle.hour };
}

/**
 * Forecast hour for a given day index. `day * 24` lands exactly on a valid
 * step for every model in this platform: 3h/6h-stepped models divide evenly,
 * WFS is hourly, and UKMO's irregular hourly-then-3-hourly-then-discrete grid
 * (0-54 hourly, 57-144 every 3h, then 150/156/162/168) still happens to
 * contain every multiple of 24 through day 7. No per-model snapping needed.
 */
export function forecastHourForDay(day: number): number {
  return day * 24;
}

function cid(model: ModelDef, cycle: Cycle): string {
  return model.tileScoping === "cycle" ? `${cycle.date}_${pad2(cycle.hour)}` : cycle.date;
}

/** The _SUCCESS marker is always cycle-scoped ({date}_{HH}), even for WFS whose tiles are date-only. */
function markerCid(cycle: Cycle): string {
  return `${cycle.date}_${pad2(cycle.hour)}`;
}

function gcsSegment(variable: VariableDef): string {
  return variable.gcsName ?? variable.id;
}

/** Representative x/y for the tile probed — every global model publishes a 2x2 z=3 grid (0/0 is
 * always populated); WFS publishes a single z=2 tile at 0/0. Same corner for every model, so no
 * per-model logic is needed here. */
const REPRESENTATIVE_TILE_XY = { x: 0, y: 0 } as const;

export function tileObjectPath(model: ModelDef, variable: VariableDef, cycle: Cycle, fh: number): string {
  const { x, y } = REPRESENTATIVE_TILE_XY;
  return `${model.id}/${gcsSegment(variable)}/${cid(model, cycle)}/f${pad3(fh)}/${model.tileZoom}/${x}/${y}.png`;
}

export function windJsonObjectPath(model: ModelDef, variable: VariableDef, cycle: Cycle, fh: number): string {
  return `${model.id}/${gcsSegment(variable)}/${cid(model, cycle)}/f${pad3(fh)}/wind_data.json`;
}

export function oceanJsonObjectPath(model: ModelDef, variable: VariableDef, cycle: Cycle, fh: number): string {
  return `${model.id}/${gcsSegment(variable)}/${cid(model, cycle)}/f${pad3(fh)}/ocean_data.json`;
}

/**
 * et0/gdd only: NOT pinned to any fixed cycle hour — confirmed against
 * platform-processing-pipeline's ecmwf/et0 and ecmwf/gdd, whose `main.py` calls
 * the same `get_latest_ecmwf_run()` as every other ECMWF variable and writes
 * tiles under whichever cycle that resolves to (00Z ~07:34-19:34 UTC, 12Z the
 * rest of the day — see `generate_tiles.py`'s `{date}_{cycle:02d}/d{NN}/...`
 * path). platform-api-server's `tile_cycles.py` resolves the serving cycle the
 * same generic, marker-based way for et0/gdd as for any other tile variable —
 * there is no special-casing to 12Z anywhere in the real pipeline. The caller
 * must pass whichever cycle it has already confirmed (via the variable's own
 * `_SUCCESS` marker, see `resolveDailyCycle` in matrixRunner.ts) rather than a
 * fixed hour.
 */
export function dailyTileObjectPath(model: ModelDef, variable: VariableDef, cycle: Cycle, day: number): string {
  const { x, y } = REPRESENTATIVE_TILE_XY;
  return `${model.id}/${gcsSegment(variable)}/${cid(model, cycle)}/d${pad2(day)}/${model.tileZoom}/${x}/${y}.png`;
}

export function successMarkerObjectPath(model: ModelDef, variable: VariableDef, cycle: Cycle): string {
  return `${model.id}/${gcsSegment(variable)}/${markerCid(cycle)}/_SUCCESS`;
}

export function publicUrl(objectPath: string): string {
  return `${TILE_PUBLIC_BASE}/${objectPath}`;
}

/** Object path for a Tier-1 (variable, day) cell, dispatching on the variable's kind. Returns
 * null for daily-tile variables, which go through dailyTileObjectPath + resolveDailyCycle
 * instead (they don't follow the normal cycle/forecast-hour shape at all). */
export function objectPathForCell(
  model: ModelDef,
  variable: VariableDef,
  cycle: Cycle,
  day: number
): string | null {
  const fh = forecastHourForDay(day);
  switch (variable.kind) {
    case "tile":
      return tileObjectPath(model, variable, cycle, fh);
    case "wind-json":
      return windJsonObjectPath(model, variable, cycle, fh);
    case "ocean-json":
      return oceanJsonObjectPath(model, variable, cycle, fh);
    case "daily-tile":
      return null;
  }
}
