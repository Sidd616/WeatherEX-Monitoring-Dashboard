# WeatherEX Monitoring Dashboard — Plan

## 1. Problem

The frontend (`platform-frontend`) depends on the backend (`platform-api-server`), which depends on
the processing pipeline (`platform-processing-pipeline`) having actually produced the data in GCS.
When something is missing, the frontend just silently fails to show that one thing, and finding out
*what* is broken today means manually clicking through every model × variable × day combination.

This project is a **standalone, independent dashboard** (its own repo, no changes to the other three)
that automatically probes the whole surface of the platform and reports, at a glance:

- 🟢 **Green** — working normally.
- 🟡 **Yellow** — working, but only because a fallback/degraded path kicked in.
- 🔴 **Red** — broken, fallback also failed (or doesn't exist).
- ⚪ **Gray** — check itself couldn't complete (network/timeout) — *not* the same as confirmed-broken.

Sorted/filterable by model, by severity (worst first), by variable, etc., so a supervisor can act on
it in seconds instead of clicking through the product by hand.

## 2. What research found (read before touching the checker logic)

Three parallel research passes (frontend config, `platform-api-server`, `platform-processing-pipeline`)
produced the ground truth below. The full per-model detail lives in code as the single source of truth:
[`server/src/config/testMatrix.ts`](server/src/config/testMatrix.ts) — treat this section as a summary,
that file as authoritative.

### 2.1 Nine models, and where their real ceilings differ from what the product promises

| Model | Pipeline cycles | Real max horizon (pipeline) | Frontend's promised `forecastDays` | Gap? |
|---|---|---|---|---|
| GFS | 00/06/12/18Z | 384h = 16d, uniform | 16 | none |
| ECMWF | 00/12Z | **144h = 6d** for 19 of 20 variables; `et0`/`gdd` alone go to 14d (day-indexed, always off the 12Z run) | 15 | **temperature/wind/etc. beyond day 6 will show Red — that's real, not a bug in the dashboard** |
| ICON | 00/06/12/18Z | 120h = 5d, **except `humidity`: 9h only** | 5 | **`humidity` beyond ~9h is a live landmine** |
| ECMWF-AIFS | 00/06/12/18Z | 360h = 15d, **except `humidity`: 54h only** | 15 | **`humidity` beyond ~2 days is a live landmine** |
| AIGFS | 00/06/12/18Z | 384h = 16d (precipitation starts at f006, not f000) | 16 | none |
| UKMO | 00/12Z only (06/18 skipped, upstream too short) | 168h = 7d, uniform | 7 | none |
| JMA | 00/12Z only | 264h = 11d, uniform, but **date-scoped, no `_SUCCESS` ever** | 11 | none (just a different check strategy) |
| copernicusmarine (CMEMS) | pseudo-daily, ready ~13:00 UTC | ~222h ≈ 9d for the 5 *scheduled* variables | 8 | see 2.2 — three of its six listed variables are never produced at all |
| WFS | unscheduled (manual/cron on a GPU box, cadence unverifiable) | 72h = 3d | 3 | none, but treat freshness as best-effort |

### 2.2 Standing gap already live in production (dashboard will show this Red from the first run)

`platform-frontend/src/config/models.config.ts` lists `copernicusmarine.availableVariables` as
`ocean_current, sst, salinity, wave_height, wave_direction, wave_period`. The pipeline's own
`copernicusmarine/function/main.py` `VARIABLES` list only actually schedules
`ocean_current, wave_height, wave_direction, strokes_drift_x_velocity, ocean_current_vo` — **`sst`,
`salinity`, and `wave_period` have full folders/Dockerfiles/CI but are commented out of the scheduler
and will never produce fresh output.** A user can select them in the product today and get nothing.
Confirm with the team whether to re-enable the pipeline jobs or pull the options from the UI.

### 2.3 Other real findings worth a human looking at (surfaced here so they're not lost, not because the dashboard needs to special-case them)

- `platform-frontend/src/api/lightningApi.ts` calls `GET /public/lightning/recent` — **this route does
  not exist anywhere in `platform-api-server`** (zero grep hits). It existed per a memory from
  2026-07-13; either removed since or never deployed. Will 404 every time until confirmed.
- `GET /public/wave-velocity/<model>/f<fh>` is a stub in the backend — always returns "not implemented
  yet." Excluded from the checker's expectations (would be permanently Red otherwise); listed as a
  known gap instead.
- `platform-api-server`'s `get_satellite_cloud_cover_url()` builds `satellite/cloud_cover/latest/...`,
  which doesn't match anything the pipeline writes (`satellite-cloud-cover/cloud_cover_tile/...` is
  the real path, built by a different, correct function). Likely dead code — not wired into the
  checker until confirmed.
- The API server references a "GeoColor" satellite pipeline (`geocolor_tile/`, `geocolor_flow/`) with
  no producer found anywhere in `platform-processing-pipeline`. Unconfirmed origin — excluded from v1.
- `.github/workflows/ecmwf-aifs-cape-processor.yml` is orphaned (no matching folder/variable). Repo
  hygiene noise, not a monitoring target.

### 2.4 The one fact that decides the whole checker architecture

`/public/point`, `/public/points/bulk`, and `/public/timescale` almost never return an HTTP error.
A missing TileDB array or a failed read is swallowed server-side and comes back as **HTTP 200,
`success:true`, `value: null`** (or empty `points`/`results`). **Any checker that only looks at HTTP
status will report false Green on these three routes.** Every check must inspect the JSON payload.
Conversely, GCS tile/JSON existence checks (plain `HEAD` requests against public URLs) are exact and
cheap — no such trap, no credentials needed.

### 2.5 Fallback mechanisms → the actual Yellow triggers

- **Date/cycle fallback** (tiles, point, timescale, wind-velocity, ocean-velocity): on failure, retry
  with the previous day + `fh+24` (the backend's own `?fallback=1`, mirrored by
  `platform-frontend/src/api/windApi.ts`). Succeeds on fallback → Yellow. Fails past `MAX_FH` too
  (`fallback_fh_overflow`) → Red.
- **Tile `_SUCCESS`-marker resolution**: if GCS is unreachable when checking the marker, the backend
  silently reverts to the plain-date tile path (possibly stale) → Yellow.
- **Cyclones/airports** (`JsonSource` "keep last known good" pattern): feed never loaded → `503` → Red.
  Loaded but old → still `200` with `stale`/`obsStale:true` in the payload → Yellow. Airports' `obs`
  ingest also has a silent "drop guard" (skips writing if the new row count is <50% of the last run's)
  — a stale-but-present file is a distinct, real failure mode, not just "file missing."
- **GeoColor cloud tiles**: 200-with-bytes = Green, 404 = Green (genuine "clear sky," not a failure),
  503 = Red. Cleanest 3-way split in the codebase — model other checks on this where it fits.

## 3. What gets tested

### Tier 1 — the core ask: model × variable × day matrix

Scoped to exactly what the product promises: `MODEL_CONFIGS[model].availableVariables` ×
`MODEL_CONFIGS[model].forecastDays`, for all 9 models. Every cell in this grid is something a real
user can select today, so every Red is directly actionable. Day 0 (the initial/analysis step) plus
one representative forecast hour per day (`day * 24`, snapped to that model's actual step grid — e.g.
UKMO's irregular hourly→3-hourly→6-hourly schedule) — not every 3-hourly step. That keeps a full sweep
to roughly 1,500–2,500 lightweight `HEAD` requests, comfortably parallelizable in well under a minute.

Per-cell check, in order:
1. `HEAD` the tile PNG (or `wind_data.json`/`ocean_data.json` for JSON-only variables) at that
   model/variable/cycle/forecast-hour's real GCS path (see §2, exact templates in `testMatrix.ts`).
   200 → **Green**.
2. On 404, retry the equivalent fallback path (previous day, `fh+24`) — the exact same shift the
   backend itself performs. 200 → **Yellow**.
3. Still 404 → **Red**.
4. Network error/timeout on either step → **Gray** (unknown, not confirmed-broken).

No GCP credentials needed — tiles, wind/ocean JSON, `_SUCCESS` markers, cyclone/airport JSON are all
public objects under `weather-tiles` (confirmed: the frontend itself fetches them directly from the
browser).

### Tier 2 — platform features (not day-shaped, existence + freshness instead)

Cyclones, airports, webcams, satellite (legacy + GeoColor where confirmed), chatbot health, MOSDAC
proxy. Each gets its own check: does the endpoint/file exist, and is it fresh against its own known
cadence (cyclones 15 min / stale after 45 min; airports obs 5 min / stale after 2h; airports catalog
daily 03:17 UTC).

### Tier 3 — informational only, kept out of the main grid

Variables the pipeline produces but the product doesn't expose yet (GFS's `cape`/`cin`/`lift_index`,
AIGFS's `humidity`, WFS's `cldfra`/`sh2o`/`smois`/`tslb`). Shown in a separate "pipeline extras" panel
so unused pipeline capacity never gets confused with a broken product feature.

### Out of scope for v1 (flagged, not forgotten)

- `/v1/*` — the API-key-gated paid weather API. Different product surface, no key available here.
  Easy to add later behind its own panel if wanted.
- WFS true scheduling cadence — unverifiable from code (no committed Cloud Scheduler config); treated
  as best-effort freshness only.
- The unconfirmed dead/legacy paths in §2.3.

## 4. Architecture

Plain two-package repo, npm workspaces, both runnable with one `npm install` + `npm run dev`:

```
monitoring-dashboard/
  server/   Node 24 + TypeScript + Express + node-cron + better-sqlite3
  web/      Vite + React 19 + TypeScript + Tailwind 4   (mirrors platform-frontend's stack)
```

- **No GCP credentials required** — the whole checker runs on public `fetch()` HEAD/GET calls against
  `storage.googleapis.com/weather-tiles/...` and `https://api.weatherex.ai/public/...`.
- **Storage**: SQLite (`better-sqlite3`, single file, zero external setup) — stores full run history,
  not just the latest snapshot, so a later "how long has this been red" view is just a query away.
- **Scheduler**: `node-cron` inside the server process. Tier 1 full sweep every 30 min; Tier 2 feature
  checks every 5–15 min (matching their own real cadence); a manual "Run now" button hits the same
  code path on demand.
- **Deploy-ready, not deployed**: includes a `Dockerfile` (mirrors the pattern `platform-api-server`
  already uses) so this can go on Cloud Run later, but nothing gets deployed as part of this work —
  that's a separate, explicit step when you're ready for it.

### REST contract (`server` → `web`)

- `GET /api/summary` — counts by status, last run time, per-model rollup.
- `GET /api/models/:model` — full variable × day grid for one model.
- `GET /api/cell/:model/:variable/:day` — drill-down: exact URLs probed, raw responses, timestamps.
- `GET /api/features` — Tier 2 results.
- `GET /api/extras` — Tier 3 informational panel.
- `POST /api/run` / `GET /api/run/status` — manual trigger + in-progress flag.

## 5. UI

Minimalistic, information-dense, sorted by what a supervisor needs first:

- Summary bar up top: total Green/Yellow/Red/Gray counts, last-run timestamp, Run-now button.
- Sort/filter: by model, by severity (Red-first), by variable, text search.
- Per-model card → expands into the variable × day heatmap grid (color-coded cells).
- Click a cell → drawer with the exact check performed and raw response, for fast root-cause triage.
- Separate, visually distinct sections for Tier 2 (features) and Tier 3 (informational extras) so they
  never get mistaken for core product breakage.
- Dark/light aware, matches the visual language of `platform-frontend` without copying its code.

## 6. Build order

1. Repo scaffold, shared matrix config + path builders + status logic (`server/src/config`,
   `server/src/checks`).
2. Backend: SQLite schema, scheduler, checker execution, REST API.
3. Frontend: dashboard UI against the REST contract above.
4. Wire up, run both locally, verify in a real browser against production `api.weatherex.ai` and the
   public `weather-tiles` bucket.
5. (Later, on request) Dockerize + deploy + auth, if/when this needs to be reachable by people other
   than whoever runs it locally.

## 7. Decisions made without asking (flag anything you'd rather have differently)

- **Scope** = frontend-promised matrix as the primary grid (directly answers "what's broken for our
  users right now"); pipeline-only extras get their own informational panel instead of inflating the
  main grid or being dropped entirely.
- **Local-first**, but Cloud-Run-deployable from day one (Dockerfile included) — actual deployment is
  a separate step, not assumed.
- **No auth yet** — this is an internal ops tool to start; add auth before anyone outside the team gets
  the link.
- **`/v1/*` excluded** — no API key available, different product surface.
- Day granularity = one forecast hour per day, not every 3-hourly step (keeps a full sweep fast; the
  per-cell drawer can still show the exact hour checked).

## 8. First live run (2026-09-24) — corrections to this doc, and what it found

The backend went live and ran its first real sweeps (1,423 cells, ~35s each) within hours of the
research above being written. Two of that research's own conclusions didn't survive contact with
production — worth stating plainly, since it's the clearest demonstration of why this dashboard needs
to exist rather than a document like this one: **static code research goes stale fast on an
actively-developed pipeline; only a live, recurring check stays true.**

### Corrected (the original research's claims did not reproduce live)

- **copernicusmarine `sst`/`salinity`/`wave_period`** — §2.2 above claimed these were permanently
  disabled (commented out of the pipeline's scheduler). Live: all three came back **green**, with GCS
  `Last-Modified` timestamps within ~26 minutes of a confirmed-active sibling variable — genuinely
  fresh output. Either re-enabled since the research, or the research was already stale. The `knownGap`
  markers on these three have been removed from `testMatrix.ts` so the dashboard doesn't keep badging
  a working feature as a known issue.
- **ECMWF's presumed 6-day (144h) ceiling on non-`et0`/`gdd` variables** — §2.1's table claimed this.
  Live: `temperature` ran green through the full promised day 15. The model-level note in
  `testMatrix.ts` now points at this correction instead of asserting the (wrong) cap.

### A real bug this caught in the dashboard's own code, before it could mislead anyone

The daily-tile path for `et0`/`gdd` (always the 12Z run, regardless of a model's other cycle hours)
was initially built from the model's general `latestCycle().date` — which can walk to *today* via an
earlier-ready non-12Z cycle before today's 12Z run is actually out. That showed up as a partial-day
false-red on `gdd` that had nothing to do with real data. Fixed with a dedicated
`latestDailyCycleDate()` that checks 12Z's own readiness directly (`paths.ts`). After the fix, `gdd`
is a clean 100% green across all 14 days — and it isolated a second, genuine, unrelated gap in `et0`
below.

### New findings — real, current, nobody had visibility into these before this dashboard existed

- **`ecmwf-aifs` is completely down**: all 9 variables, all 16 days, 100% red — not even one fallback
  succeeds anywhere. Manually cross-checked directly against GCS (4 dates x all 4 cycle hours x
  `temperature`: 16/16 requests 404). Reads as a full, current pipeline outage for this model.
- **JMA `temperature` specifically is 100% missing** (confirmed 404 across every date checked) while
  every other JMA variable is healthy. Isolated to this one variable, not a whole-model problem.
- **WFS**: more than half its promised variables are currently non-functional — `temperature`(`t2`),
  `pressure`(`psfc`), `solar`(`swdown`), and all four `soil_moisture_*` depths are 100% red. Only
  `precipitation` and the wind variables are actually live.
- **ECMWF `et0` is completely absent** (its full `d01`-`d13` range 404s) even on the identical 12Z
  cycle where sibling `gdd` is fully present. A genuine, isolated gap, now cleanly visible after the
  timing-artifact fix above.
- **GFS `wind_speed_1500m`** is 100% red across all 17 days while its neighboring altitude levels
  (800m, 3000m, 4200m, ...) are mostly green. Narrow, specific, easy to miss by hand — exactly the
  shape of thing this dashboard is for.

None of the five findings above are edited into `testMatrix.ts` as `knownGap`s — unlike the
structural facts that belong in static config (day-index asymmetries, path-naming quirks), these are
*current operational state*, which is exactly what the dashboard's own live cells exist to show on an
ongoing basis. Hardcoding today's outage into the config would only go stale the same way the research
above did. Follow up with the team on all five; re-run the dashboard to see whether they're still live
by the time you do.

## 9. Second correction (2026-09-28) — the "et0 completely absent" finding above was the dashboard's own bug

A user report ("et0 shows full red, but I can see its tile on the frontend right now") led to re-checking
the fix described in §8 ("A real bug this caught... Fixed with a dedicated `latestDailyCycleDate()`") —
and that fix turned out to be only half right, and is very likely the actual cause of the "ECMWF `et0` is
completely absent" finding in §8, not a real pipeline gap.

**The wrong assumption**: `latestDailyCycleDate()` and `dailyTileObjectPath()` treated et0/gdd tiles as
always published under the 12Z run, on the theory that daily-cadence variables are "keyed to 12Z
regardless of what the model's other cycles do." Verified false against
`platform-processing-pipeline/ecmwf/et0/main.py` and `ecmwf/gdd/main.py`: both call the exact same
`get_latest_ecmwf_run()` every other ECMWF variable's pipeline uses, which returns 00Z for most of the
UTC day (~07:34–19:34) and 12Z the rest — and `generate_tiles.py` writes tiles to
`{prefix}/{date}_{cycle:02d}/d{NN}/...`, i.e. genuinely cycle-scoped, both cycles, same as any other
variable. `platform-api-server/app/services/tile_cycles.py`'s `resolve_tile_cycle_id()` confirms this
from the serving side too: et0/gdd go through the same generic, marker-based cycle resolution as every
other tile variable (walk `MODEL_CYCLE_HOURS["ecmwf"] = (12, 0)` newest-first, serve whichever cycle's
own `_SUCCESS` marker exists) — there is no 12Z-only special case anywhere in the real system. A live tile
the user pulled straight off the frontend, `.../ecmwf/et0/20260927_00/d04/3/0/0.png`, confirms the 00Z
path is real and populated.

**Why the original "fix" looked right at the time**: it silently swapped one bug (reusing
`latestCycle(model).date` — correct date, but combined with an already-hardcoded `_12` suffix, so it
could probe a same-day 12Z folder before that cycle had actually finished) for another (pinning to 12Z
unconditionally) — and whatever the sweep's timing happened to be that day, the request landed inside
12Z's true window often enough that `gdd` read "clean 100% green across all 14 days," masking the
regression. `et0`'s "fully absent" result was very likely this same bug landing outside that window.

**The real fix**: `resolveDailyCycle()` (`server/src/checks/matrixRunner.ts`) now probes the variable's
own `_SUCCESS` marker directly — today's cycle hours newest-first, then yesterday's — exactly mirroring
`resolve_tile_cycle_id`, instead of guessing a cycle from a lag-hour estimate. `dailyTileObjectPath()`
now takes the resolved `Cycle` (date *and* hour) instead of a bare date with `_12` baked in.
`latestDailyCycleDate()` is gone. Re-run the dashboard and confirm et0 goes green before treating any
remaining et0/gdd red as real.

## 10. Third correction (2026-09-28, same day) — the §8 "ecmwf-aifs is completely down" finding was also the dashboard's own bug, plus a real config misclassification

A second user report ("ecmwf-aifs tiles are present but the dashboard shows all red") turned out to be
the *general-purpose* version of §9's bug, not a one-off in the daily-tile path — plus one unrelated,
genuine config mistake it exposed along the way.

**Bug 1 (systemic, all models): `latestCycle()`'s lag-hour estimate was being trusted to pick which
cycle to probe, with no live confirmation.** Live-checked against `ecmwf-aifs` at 2026-09-28T08:17 UTC:
`latestCycle()` estimated `{20260928, 00}` (17 minutes past its configured 8h lag) — but that cycle's
marker, and nearly all its tiles, didn't exist yet anywhere in GCS. The actual latest complete cycle was
the previous one, `20260927_18`, fully live. Because `checkStandardCell`'s fallback probe is *also*
derived from that same estimate (`fallbackCycle(cycle)`, i.e. one day further back on the same wrong
hour), an over-optimistic guess doesn't degrade one cell to yellow — both the primary and fallback probe
miss, and the *entire model* reds out. This is almost certainly what actually produced the §8 finding
"ecmwf-aifs is completely down: all 9 variables, all 16 days, 100% red" — not a real pipeline outage.

Fix: `resolveConfirmedCycle()` (`server/src/checks/matrixRunner.ts`, generalized from §9's
`resolveDailyCycle`) now confirms a variable's cycle live via its own `_SUCCESS` marker before probing
any of its day-cells, for every model with `hasSuccessMarker` — not just et0/gdd. It's resolved
per-*variable*, not once per model: live-checked, `ecmwf-aifs`'s `rain_accumulation` had a marker for
`20260927_18` while `temperature` did not (its latest confirmed cycle was `20260927_06`) — different
variables of the same model can genuinely finish at different real times. `latestCycle()`'s estimate is
kept only as the graceful fallback when no marker confirms anything (network hiccup, or a pipeline that
has never posted a marker), matching `resolve_tile_cycle_id`'s own behavior, and is still used as-is for
the separate, purely-informational marker-presence check in the features panel.

**Bug 2 (config, ecmwf-aifs only): `wind_speed_10m`/`wind_speed_100m` were classified `kind: "wind-json"`,
copied from plain ECMWF's config — but ecmwf-aifs's own pipeline never produces JSON for these.**
`platform-processing-pipeline/ecmwf/wind_speed_10m/main.py` calls `generate_tiles_json`, which writes
both `wind_data.json` and PNG tiles — the "wind-json" classification is correct for plain ECMWF.
`platform-processing-pipeline/ecmwf-aifs/wind_speed_10m/main.py` (and `wind_speed_100m`) only ever
imports and calls `generate_grayscale_tiles` — confirmed live, no `wind_data.json` exists at any
forecast hour, only the PNG tile set (`wind_direction` is unaffected — its own pipeline does write
`wind_data.json`, confirmed live). Every cell of both variables was probing a URL that can never exist,
on every cycle, forever. Fixed in `server/src/config/models.ts`: both switched to `kind: "tile"`.

**Confirmed live after both fixes** (`ecmwf-aifs`, 2026-09-28T08:23 UTC): `temperature`, `solar`,
`pressure`, `cloud_cover`, `wind_speed_10m`, `wind_speed_100m`, `wind_direction` all green day 1 through
their tested range; `precipitation` green through day 4 then red days 8/12/15 (worth a look, but no
longer *universally* red); `humidity` still fully red — no `_SUCCESS` marker found within the 2-day
lookback on any of its cycle hours, consistent with the existing "likely unresolved bug" note on this
variable, so left as a real, standing gap rather than special-cased away. Day 0 (`f000`) is red across
*every* variable regardless of the above fixes — the pipeline does request step 0
(`range(0, 361, 6)` in `ecmwf-aifs/temperature/main.py`), so this reads as ECMWF AIFS's public open-data
feed genuinely not publishing an analysis (step-0) field, the same shape of gap as AIGFS's
no-f000-precipitation already in this config — flagged here rather than silently encoded as a
`startDay`, since it's one data point, not yet confirmed to be permanent.

## 11. Fourth correction (2026-09-28, same day) — a real code bug found while checking a rate-limiting hypothesis, unrelated to rate limiting itself

A user asked whether "Run now" flooding the real platform with concurrent requests could itself be
causing false reds (e.g. via rate limiting). Investigated both empirically and by reading the code:

**Empirically, nothing is currently rate-limiting this checker.** `platform-api-server`'s
`app/limiter.py` has no `@limiter.limit(...)` on any `/public/*` route the dashboard's Tier-2 checks
hit — only the paid `/v1/*` routes and `/contact` are limited, and `default_limits=[]` means no blanket
limit applies either. Tier 1 (the vast majority of request volume) never goes through
`platform-api-server` or the `tiles.weatherex.ai` CDN at all — `TILE_PUBLIC_BASE` in this dashboard is
hardcoded straight to `storage.googleapis.com`, bypassing any CDN-level throttling entirely. Burst-tested
raw GCS directly at the checker's real concurrency (24) up to 2,200 requests in ~19s and 300 repeated
requests against the identical URL: zero 429s, zero 503s, p95 latency under 400ms throughout.

**But the investigation surfaced a real, separate bug: the code didn't match this document's own §3
spec.** §3 states plainly: *"Network error/timeout on either step → Gray (unknown, not
confirmed-broken)."* `checkStandardCell`'s fallback branch (`server/src/checks/matrixRunner.ts`) didn't
honor that for the *second* (fallback) probe — its `else` branch mapped "fallback 404, or any other
status/error" straight to **red**, with a comment explicitly noting it was "never downgraded to gray
here." That's inconsistent with the primary probe's own handling two branches up, which correctly grays
out anything that isn't a clean 404. In practice this was latent (GCS isn't currently erroring on us),
but it meant *any* transient failure landing specifically on the fallback probe — a timeout, a 5xx, or
rate limiting if it were ever introduced upstream — would have been misreported as confirmed-broken
rather than unknown.

Fixed: the fallback branch now only reports **red** when the fallback probe is *also* a clean, confirmed
404 (`fallback.status === 404 && fallback.error === null`). Any other fallback outcome (timeout, 5xx,
429, or any other unclean response) now reports **gray**, matching the primary probe's own equivalent
branch and this document's own stated design.

## 12. Fifth correction (2026-09-28, same day) — the §8 "WFS more than half broken" finding was three wrong `gcsName`s and one wrong knownGap

A user report with five working `tiles.weatherex.ai/wfs/...` URLs (temperature, pressure, solar, and all
four soil-moisture depths) directly contradicted §8's claim that these were "100% red." All five turned
out to be config mistakes in `server/src/config/models.ts`, not platform issues:

**`temperature`/`pressure`/`solar` had wrong `gcsName` overrides** (`"t2"`/`"psfc"`/`"swdown"`). Those
are only `platform-processing-pipeline/wfs/`'s own *source folder* names — each folder's `main.py` sets
`GCS_TILE_PREFIX = f"{MODEL}/{VARIABLE}"` from its own `VARIABLE` constant, which is the literal string
`"temperature"` / `"pressure"` / `"solar"`, not the folder name. Confirmed live:
`wfs/temperature|pressure|solar/...` all 200, `wfs/t2|psfc|swdown/...` all 404 — the dashboard was
checking paths that can never exist. Fixed by dropping the `gcsName` override on all three (their plain
`id` is already the correct GCS segment, same as `precipitation` and `wind_direction` in the same model).

**All four `soil_moisture_*` depths had a `knownGap` claiming they collide onto one shared GCS path**,
inherited from a source-only read of `wfs/smois/main.py` (which does hardcode a single
`VARIABLE = "soil_moisture"` with no visible per-depth override). Confirmed FALSE live: `wfs/soil_moisture_0_10cm`,
`_10_40cm`, `_40_100cm`, and `_100_200cm` are each their own distinct, populated GCS path — whatever the
deployed pipeline actually does differs from what's in this source snapshot (worth a separate look by
whoever owns that repo, but irrelevant to this checker once confirmed live). Fixed by dropping both the
`gcsName: "soil_moisture"` override and the `knownGap` on all four.

**Confirmed live after the fix**: every WFS variable — `precipitation`, `temperature`, `pressure`,
`solar`, `wind_speed_10m`, `wind_direction`, and all four `soil_moisture_*` depths — reads 100% green
across all 4 days. §8's "more than half its promised variables are currently non-functional" was five
config bugs, not a platform outage; WFS is fully healthy.

## 13. UX fix (2026-09-29) — wind altitude levels now labeled by pressure, matching platform-frontend

Not a checker bug — a display mismatch flagged as confusing. `platform-frontend`'s wind picker labels
the six altitude levels by pressure (925/850/700/600/500/300 hPa); this dashboard showed the same rows
by their meter-based `id` (`wind_speed_800m` etc.), so the same data read as two different things
depending which UI you were looking at.

Added an optional `label` field to `VariableDef` (`server/src/config/models.ts`) — display-only, never
touches path construction or the DB key, so `id` stays the real meter-based GCS segment everywhere it
matters. The hPa values aren't guessed from a standard-atmosphere table: confirmed from the pipeline's
own source, `platform-processing-pipeline/ecmwf/wind_speed_800m/main.py`'s `PRESSURE_LEVELS = [925]`
agreeing with `gfs/wind_speed_800m/main.py`'s `lev_925_mb`, and the same cross-check for all six levels.
10m/100m are untouched — platform-frontend itself labels those two in meters, so no mismatch existed
there. Piped `label` through the REST API (`/api/models/:model`) and the frontend (`ModelCard.tsx` shows
`label ?? id`, with the raw `id` kept as a hint for anyone tracing back to the actual GCS path); search
now matches on `label` too, so typing "925" or "hpa" finds the row.

## 14. Sixth correction (2026-10-01) — §9's own fix wasn't enough: a 2-day lookback is too narrow for et0/gdd

A user flagged a live, working et0 tile (`.../ecmwf/et0/20260929_12/d13/.../0/0.png`, confirmed 200, both
corners) while the dashboard showed et0 as fully red. §9 (2026-09-28) had already fixed the "always
assume 12Z" bug by making the dashboard confirm the cycle via the variable's own `_SUCCESS` marker — but
that fix only looked back two candidate dates (today, yesterday). Live-checked on 2026-10-01 (now):
neither `20261001` nor `20260930`'s cycles had a marker for et0 — the real latest completed run was
`20260929_12`, a full **two** days back, and that's exactly the cycle the live frontend tile was still
being served from. The 2-day window meant `resolveConfirmedCycle` found nothing, fell back to
`latestCycle()`'s unpublished lag estimate, and reported the entire variable red despite real, current,
served data existing one day outside the search window.

This reads as a recurring trait of et0/gdd specifically, not a one-off: both pipelines download and
process the model's *entire* multi-day forecast range before writing anything (§9), so a single slow or
failed run costs them more than the one day a lighter per-forecast-hour pipeline would typically lose.

Fixed: `resolveConfirmedCycle` (`server/src/checks/matrixRunner.ts`) now walks up to
`MAX_CYCLE_LOOKBACK_DAYS = 7` days back (still newest-first, still per-variable, still falling back to
the lag estimate only once the whole window comes up empty) instead of just today and yesterday. Seven
days is a deliberate bound, not an attempt to search indefinitely — past roughly that point, "technically
findable several days back" stops being meaningfully different from "actually broken," and surfacing
that as red is this checker's job, not something to paper over with an ever-growing lookback. Confirmed
live after the fix: `et0` resolves to `20260929_12` and reads green across all 13 days (`d1`-`d13`,
matching the user's tile exactly); `gdd` resolves to a fresher `20260930_12` and is also fully green.
