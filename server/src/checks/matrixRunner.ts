// Tier 1: the model x variable x day matrix. Implements the status algorithm from PLAN.md
// section 2.4/2.5 exactly, in order — see the branch comments below for which clause of the
// spec each one is. All actual network calls go through checks/http.ts, which owns the shared
// concurrency limit, so it's safe to fan every cell out as its own task here.

import { MODEL_CONFIGS, MODEL_IDS, type ModelDef, type VariableDef } from "../config/models.js";
import {
  dailyTileObjectPath,
  fallbackCycle,
  forecastHourForDay,
  latestCycle,
  objectPathForCell,
  oceanJsonObjectPath,
  publicUrl,
  successMarkerObjectPath,
  tileObjectPath,
  toYYYYMMDD,
  windJsonObjectPath,
  type Cycle,
} from "../config/paths.js";
import { upsertCell, upsertMarker } from "../db/db.js";
import type { CellResult, MarkerResult } from "../types.js";
import { headCheck } from "./http.js";

/** Builds the GCS object path for an explicit forecast hour, bypassing objectPathForCell's
 * day -> fh conversion. Needed for the fallback probe, which wants fh+24 directly rather than
 * a day index that would round-trip back through forecastHourForDay. daily-tile variables never
 * reach this — they have no fh-shaped fallback (no fallback attempt at all, see below). */
function objectPathForFh(model: ModelDef, variable: VariableDef, cycle: Cycle, fh: number): string {
  switch (variable.kind) {
    case "tile":
      return tileObjectPath(model, variable, cycle, fh);
    case "wind-json":
      return windJsonObjectPath(model, variable, cycle, fh);
    case "ocean-json":
      return oceanJsonObjectPath(model, variable, cycle, fh);
    case "daily-tile":
      throw new Error(`objectPathForFh: "${variable.id}" is a daily-tile variable and has no fh-based path`);
  }
}

async function checkStandardCell(model: ModelDef, variable: VariableDef, cycle: Cycle, day: number): Promise<void> {
  const fh = forecastHourForDay(day);
  const url = publicUrl(objectPathForCell(model, variable, cycle, day)!);
  const primary = await headCheck(url);

  const base = {
    model: model.id,
    variable: variable.id,
    day,
    checkedUrl: url,
    knownGap: variable.knownGap,
    checkedAt: new Date().toISOString(),
  };

  let result: CellResult;

  if (primary.ok) {
    // Step 2: 200 -> green, done, no fallback attempt.
    result = { ...base, status: "green", httpStatus: primary.status ?? undefined };
  } else if (primary.status === 404 && primary.error === null) {
    // Step 3/5: confirmed clean 404 -> attempt the fallback (previous day, fh+24).
    const fbCycle = fallbackCycle(cycle);
    const fbFh = fh + 24;
    const fbUrl = publicUrl(objectPathForFh(model, variable, fbCycle, fbFh));
    const fallback = await headCheck(fbUrl);

    if (fallback.ok) {
      // Step 6: fallback 200 -> yellow.
      result = {
        ...base,
        status: "yellow",
        httpStatus: primary.status ?? undefined,
        fallbackUrl: fbUrl,
        fallbackHttpStatus: fallback.status ?? undefined,
      };
    } else if (fallback.status === 404 && fallback.error === null) {
      // Step 6: fallback ALSO a confirmed clean 404 -> genuinely red. This is the only
      // branch that gets to claim "confirmed broken" -- both probes have to have cleanly
      // resolved to "not found", not merely failed to resolve.
      result = {
        ...base,
        status: "red",
        httpStatus: primary.status ?? undefined,
        fallbackUrl: fbUrl,
        fallbackHttpStatus: fallback.status ?? undefined,
      };
    } else {
      // The fallback probe itself was inconclusive (transport error/timeout, or an
      // unexpected status like 429/500/503) -- we confirmed the primary is missing, but
      // never got a clean read on the fallback, so "confirmed broken" isn't warranted.
      // Mirrors the primary's own equivalent branch below: an inconclusive check is gray,
      // never downgraded to red just because it happened on the second probe instead of
      // the first. (Empirically, storage.googleapis.com does not appear to rate-limit this
      // checker's traffic even at 2000+ requests/burst -- this branch guards against transient
      // network blips generally, not a confirmed rate-limiting behavior.)
      result = {
        ...base,
        status: "gray",
        httpStatus: primary.status ?? undefined,
        fallbackUrl: fbUrl,
        fallbackHttpStatus: fallback.status ?? undefined,
        errorMessage: fallback.error ?? `unexpected fallback HTTP ${fallback.status}`,
      };
    }
  } else {
    // Step 4: any other clean status (403/500/...) or a transport error/timeout -> gray.
    // No fallback attempt — we couldn't cleanly determine the primary's real state.
    result = {
      ...base,
      status: "gray",
      httpStatus: primary.status ?? undefined,
      errorMessage: primary.error ?? `unexpected HTTP ${primary.status}`,
    };
  }

  upsertCell(result);
}

/** et0/gdd only: no fallback attempt, per the v1 simplification in the spec. Takes the
 * cycle resolveDailyCycle already confirmed complete via the variable's own _SUCCESS
 * marker — never a fixed/guessed hour, see resolveDailyCycle's doc comment for why. */
async function checkDailyTileCell(model: ModelDef, variable: VariableDef, cycle: Cycle, day: number): Promise<void> {
  const url = publicUrl(dailyTileObjectPath(model, variable, cycle, day));
  const result = await headCheck(url);
  upsertCell({
    model: model.id,
    variable: variable.id,
    day,
    status: result.ok ? "green" : "red",
    checkedUrl: url,
    httpStatus: result.status ?? undefined,
    knownGap: variable.knownGap,
    checkedAt: new Date().toISOString(),
    errorMessage: result.ok ? undefined : result.error ?? `unexpected HTTP ${result.status}`,
  });
}

/**
 * Which cycle a variable's data actually, currently lives under — confirmed
 * live via that variable's own `_SUCCESS` marker, exactly mirroring
 * platform-api-server's tile_cycles.py `resolve_tile_cycle_id`: the real
 * backend NEVER trusts a lag-hour guess for what to serve, it only ever
 * serves a cycle whose marker it has actually seen.
 *
 * `latestCycle()`'s lag-hour estimate is a fine *fallback* guess, but not safe
 * to probe cells against directly: live-checked against ecmwf-aifs, its
 * estimate landed on a cycle just 17 minutes past its configured 8h lag whose
 * marker (and almost all of whose tiles) didn't exist yet, while the previous
 * cycle was fully live. Because checkStandardCell's own fallback is derived
 * from that same estimate (`fallbackCycle(cycle)`), a single over-optimistic
 * guess doesn't degrade one cell to yellow — both probes miss, and the
 * *entire* model reds out even though a complete, very recent cycle is one
 * step back. Different variables of the same model can also finish at
 * different real times (confirmed live: ecmwf-aifs `rain_accumulation` had a
 * marker for 20260927_18 while `temperature` did not), so this must be
 * resolved per-variable, never cached across a whole model.
 *
 * Tries this model's cycle hours (newest-first) against today, then the same
 * hours against each earlier day back to MAX_CYCLE_LOOKBACK_DAYS, and returns
 * the first one whose marker exists. Live-checked against et0 on 2026-10-01:
 * neither today's nor yesterday's cycle had completed, but 20260929_12 (two
 * full days back) had, and was still the exact cycle platform-frontend was
 * serving real tiles from -- a 1-day lookback (the original version of this
 * function) would have missed it entirely and reported the whole variable
 * red, even though a real, currently-served cycle existed. et0/gdd's pipeline
 * downloads and processes the model's entire multi-day forecast range before
 * writing anything (see dailyTileObjectPath's comment), so a single slow or
 * failed run can plausibly cost it more than one day -- this looks like a
 * recurring characteristic of that pipeline, not a one-off.
 *
 * Bounded at a week rather than searched indefinitely: past some point,
 * "still technically findable several days back" stops being meaningfully
 * different from "actually broken," and this checker's job is to surface
 * that, not paper over it by searching arbitrarily far into the past.
 *
 * Falls back to latestCycle()'s own estimate if nothing is confirmed within
 * the window (a pipeline that has never posted a marker at all, or GCS being
 * unreachable) — matching resolve_tile_cycle_id's own "serve the best guess"
 * fallback — so a missing marker never stalls the sweep, only a
 * positively-confirmed one ever overrides the guess.
 */
const MAX_CYCLE_LOOKBACK_DAYS = 7;

async function resolveConfirmedCycle(model: ModelDef, variable: VariableDef, now: Date = new Date()): Promise<Cycle> {
  const estimate = latestCycle(model, now);
  if (!model.hasSuccessMarker) return estimate;

  let date = toYYYYMMDD(now);
  for (let daysBack = 0; daysBack <= MAX_CYCLE_LOOKBACK_DAYS; daysBack++) {
    for (const hour of model.cycleHours) {
      const markerUrl = publicUrl(successMarkerObjectPath(model, variable, { date, hour }));
      const marker = await headCheck(markerUrl);
      if (marker.ok) return { date, hour };
    }
    date = fallbackCycle({ date, hour: model.cycleHours[0] }).date;
  }

  return estimate;
}

async function checkMarker(model: ModelDef, variable: VariableDef, cycle: Cycle): Promise<void> {
  const url = publicUrl(successMarkerObjectPath(model, variable, cycle));
  const result = await headCheck(url);
  const marker: MarkerResult = {
    model: model.id,
    variable: variable.id,
    cycleId: `${cycle.date}_${String(cycle.hour).padStart(2, "0")}`,
    present: result.ok,
    checkedAt: new Date().toISOString(),
  };
  upsertMarker(marker);
}

/** Resolves the variable's actual confirmed cycle once, then fans its day range out as
 * its own tasks — kept as one unit so a slow/failed marker probe for one variable can
 * never block or mis-cycle another (see resolveConfirmedCycle's doc comment for why this
 * must be per-variable, not shared across a model). */
async function checkStandardVariable(model: ModelDef, variable: VariableDef): Promise<void> {
  const cycle = await resolveConfirmedCycle(model, variable);
  const startDay = variable.startDay ?? 0;
  const tasks: Promise<void>[] = [];
  for (let day = startDay; day <= variable.forecastDays; day++) {
    tasks.push(checkStandardCell(model, variable, cycle, day));
  }
  await Promise.all(tasks);
}

/** et0/gdd only: same per-variable cycle confirmation as checkStandardVariable, fanning
 * out over dailyRange instead of [startDay, forecastDays]. */
async function checkDailyTileVariable(model: ModelDef, variable: VariableDef, first: number, last: number): Promise<void> {
  const cycle = await resolveConfirmedCycle(model, variable);
  const tasks: Promise<void>[] = [];
  for (let day = first; day <= last; day++) {
    tasks.push(checkDailyTileCell(model, variable, cycle, day));
  }
  await Promise.all(tasks);
}

/** Runs the full Tier-1 sweep: every model x variable x day cell, plus one _SUCCESS marker
 * check per (model, variable) for models that have one (skipped entirely for jma, which
 * never writes a marker — model.hasSuccessMarker is already false for it in config). The
 * marker check alone still uses the plain lag-hour estimate (latestCycle) rather than
 * resolveConfirmedCycle — its whole purpose is to report whether the *currently expected*
 * cycle is done yet, which is only meaningful measured against the estimate, not against
 * whatever older cycle the data cells fell back to. */
export async function runMatrixSweep(): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const modelId of MODEL_IDS) {
    const model = MODEL_CONFIGS[modelId];
    const estimatedCycle = latestCycle(model);

    for (const variable of model.variables) {
      if (variable.kind === "daily-tile") {
        const [first, last] = variable.dailyRange ?? [0, variable.forecastDays];
        tasks.push(checkDailyTileVariable(model, variable, first, last));
      } else {
        tasks.push(checkStandardVariable(model, variable));
      }

      if (model.hasSuccessMarker) {
        tasks.push(checkMarker(model, variable, estimatedCycle));
      }
    }
  }

  await Promise.all(tasks);
}
