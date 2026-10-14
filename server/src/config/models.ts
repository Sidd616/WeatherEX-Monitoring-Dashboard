// The Tier-1 test matrix: one entry per model, scoped to exactly what
// platform-frontend/src/config/models.config.ts promises a real user (that's
// what makes every Red on the dashboard directly actionable). Cross-checked
// against the pipeline's own generate_tiles.py/main.py VARIABLES lists and
// platform-api-server's tile_cycles.py/gfs.py/url_service.py.
//
// Deliberately NOT encoded here: per-variable forecast-hour ceilings below a
// model's nominal `forecastDays` (e.g. icon/humidity really stops at ~9h,
// ecmwf-aifs/humidity at ~54h, ecmwf's non-daily variables at 144h even
// though the model promises 15 days). Those are exactly the landmines this
// dashboard exists to surface — the checker probes the model's full promised
// range and lets a real 404 tell the story, rather than a config file
// silently already knowing the answer.

export type ModelId =
  | "gfs"
  | "ecmwf"
  | "ecmwf-aifs"
  | "icon"
  | "ukmo"
  | "aigfs"
  | "copernicusmarine"
  | "jma"
  | "wfs";

export type CycleScoping = "cycle" | "date";
export type VariableKind = "tile" | "wind-json" | "ocean-json" | "daily-tile";

export interface VariableDef {
  /** Product-facing id (matches platform-frontend's Variable type where applicable). Always the
   * real GCS/DB key — never changed for display purposes, see `label`. */
  id: string;
  /** GCS folder name under weather-tiles/{model}/, when it differs from `id`. */
  gcsName?: string;
  /** Human-facing override for the UI when it differs from `id` — e.g. platform-frontend's wind
   * altitude picker shows pressure levels ("925 hPa"), not this checker's meter-based `id`
   * ("wind_speed_800m"). Display-only: never affects path construction or the DB key. */
  label?: string;
  kind: VariableKind;
  /** Forecast-day horizon this model's config promises the product for this variable. */
  forecastDays: number;
  /** First day actually published (default 0). E.g. AIGFS precipitation is a 6h-accumulation field, no f000. */
  startDay?: number;
  /** daily-tile kind only: [first, last] day index actually published (d{NN} segment, not f{HHH}). */
  dailyRange?: [number, number];
  /** Set when research already found this is a standing, known gap — lets the UI badge it
   * "known issue" instead of raising it as a fresh alert. */
  knownGap?: string;
  /** Free-text context, shown in the cell drawer. */
  note?: string;
}

export interface ModelDef {
  id: ModelId;
  label: string;
  /** UTC hours this model cycles at, newest-first. */
  cycleHours: number[];
  /** Hours after a cycle's nominal start before "today's" run is expected to be ready
   * (mirrors platform-api-server's get_latest_<model>_cycle lag). */
  availabilityLagHours: number;
  /** {YYYYMMDD}_{HH} ("cycle") vs bare {YYYYMMDD} ("date") for TILE paths. The _SUCCESS
   * marker (when hasSuccessMarker) is always {YYYYMMDD}_{HH}, even for wfs. */
  tileScoping: CycleScoping;
  hasSuccessMarker: boolean;
  /** Backend tile-pyramid zoom: 3 (2x2 world grid) for every global model, 2 (single tile) for WFS. */
  tileZoom: number;
  variables: VariableDef[];
  /** Tier 3 — pipeline produces these but the product doesn't expose them yet. Informational only. */
  extraVariables?: { id: string; note?: string }[];
  note?: string;
}

/**
 * `id` stays the real, meter-based GCS/DB key (unchanged — every path/marker check depends on
 * it). `label` is what platform-frontend actually shows for this level: its wind picker labels
 * these six rows by pressure level ("925 hPa" etc.), not altitude, and showing this checker's
 * "wind_speed_800m" next to the product's "925 hPa" for the same data was confusing enough to
 * ask about directly. Confirmed the mapping (not guessed from a standard-atmosphere table) from
 * the pipeline's own source: `platform-processing-pipeline/ecmwf/wind_speed_800m/main.py` sets
 * `PRESSURE_LEVELS = [925]`, and the matching GFS pipeline requests `lev_925_mb` — both agree,
 * and the same holds for every level below. 10m/100m aren't part of this list: platform-frontend
 * itself labels those two in meters ("10M"/"100M"), so this checker's meter-based id already
 * matches the product there and needs no override.
 */
const ALTITUDE_WIND_LEVELS = [
  { id: "wind_speed_800m", label: "925 hPa" },
  { id: "wind_speed_1500m", label: "850 hPa" },
  { id: "wind_speed_3000m", label: "700 hPa" },
  { id: "wind_speed_4200m", label: "600 hPa" },
  { id: "wind_speed_5600m", label: "500 hPa" },
  { id: "wind_speed_9200m", label: "300 hPa" },
] as const;

/** wind_direction is not a user-selectable Variable, but the user explicitly asked for a
 * "wind_direction json present or not" check — it drives particle animation for every
 * wind-capable model and is worth its own row. */
function windDirectionRow(forecastDays: number): VariableDef {
  return { id: "wind_direction", kind: "wind-json", forecastDays };
}

function altitudeWindRows(forecastDays: number): VariableDef[] {
  return ALTITUDE_WIND_LEVELS.map(({ id, label }) => ({ id, label, kind: "wind-json", forecastDays }));
}

export const MODEL_CONFIGS: Record<ModelId, ModelDef> = {
  gfs: {
    id: "gfs",
    label: "GFS",
    cycleHours: [18, 12, 6, 0],
    availabilityLagHours: 6,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    variables: [
      { id: "precipitation", kind: "tile", forecastDays: 16 },
      { id: "temperature", kind: "tile", forecastDays: 16 },
      { id: "cloud_cover", kind: "tile", forecastDays: 16 },
      { id: "cloud_cover_high", kind: "tile", forecastDays: 16 },
      { id: "cloud_cover_low", kind: "tile", forecastDays: 16 },
      { id: "cloud_cover_middle", kind: "tile", forecastDays: 16 },
      { id: "pressure", kind: "tile", forecastDays: 16 },
      { id: "wind_speed_10m", gcsName: "wind_speed", kind: "tile", forecastDays: 16 },
      { id: "wind_speed_100m", kind: "wind-json", forecastDays: 16 },
      ...altitudeWindRows(16),
      { id: "solar", kind: "tile", forecastDays: 16 },
      { id: "humidity", kind: "tile", forecastDays: 16 },
      windDirectionRow(16),
    ],
    extraVariables: [
      { id: "cape", note: "produced by the pipeline; UI hides it because CAPE is ECMWF-only by design" },
      { id: "cin" },
      { id: "lift_index" },
    ],
  },

  ecmwf: {
    id: "ecmwf",
    label: "ECMWF",
    cycleHours: [12, 0],
    availabilityLagHours: 7.5,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    note:
      "Static pipeline-code research (2026-09-24) found the pipeline's own step range capped at " +
      "144h/6 days for everything except et0/gdd, which would mean Red from day 7 on every other " +
      "variable. The dashboard's first live run contradicted this — temperature ran green through " +
      "day 15. Static analysis of a fast-moving pipeline goes stale; trust the dashboard's own " +
      "live cells over this note, which is kept only as a pointer to double back on if a real " +
      "day-7+ gap ever does show up.",
    variables: [
      { id: "temperature", kind: "tile", forecastDays: 15 },
      { id: "precipitation", gcsName: "rain_accumulation", kind: "tile", forecastDays: 15 },
      { id: "solar", gcsName: "solar_ghi", kind: "tile", forecastDays: 15 },
      { id: "pressure", kind: "tile", forecastDays: 15 },
      { id: "cloud_cover", kind: "tile", forecastDays: 15 },
      { id: "wind_speed_10m", kind: "wind-json", forecastDays: 15 },
      { id: "wind_speed_100m", kind: "wind-json", forecastDays: 15 },
      ...altitudeWindRows(15),
      { id: "humidity", kind: "tile", forecastDays: 15 },
      { id: "cape", kind: "tile", forecastDays: 15 },
      { id: "et0", kind: "daily-tile", forecastDays: 15, dailyRange: [1, 13] },
      { id: "gdd", kind: "daily-tile", forecastDays: 15, dailyRange: [0, 13] },
      { id: "soil_moisture_0_7cm", kind: "tile", forecastDays: 15 },
      { id: "soil_moisture_7_28cm", kind: "tile", forecastDays: 15 },
      { id: "soil_moisture_28_100cm", kind: "tile", forecastDays: 15 },
      windDirectionRow(15),
    ],
  },

  icon: {
    id: "icon",
    label: "ICON",
    cycleHours: [18, 12, 6, 0],
    availabilityLagHours: 6,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    note: "humidity's own pipeline step caps forecast hours at ~9h vs every sibling variable's 5 days — expect it to run Red from day 1. Flagged in research as a likely unresolved bug, not documented design.",
    variables: [
      { id: "temperature", kind: "tile", forecastDays: 5 },
      { id: "precipitation", kind: "tile", forecastDays: 5 },
      { id: "humidity", kind: "tile", forecastDays: 5 },
      { id: "cloud_cover", kind: "tile", forecastDays: 5 },
      { id: "cloud_cover_high", kind: "tile", forecastDays: 5 },
      { id: "cloud_cover_low", kind: "tile", forecastDays: 5 },
      { id: "cloud_cover_middle", kind: "tile", forecastDays: 5 },
      { id: "pressure", kind: "tile", forecastDays: 5 },
      { id: "wind_speed_10m", gcsName: "wind_speed", kind: "tile", forecastDays: 5 },
      { id: "solar", kind: "tile", forecastDays: 5 },
      windDirectionRow(5),
    ],
  },

  "ecmwf-aifs": {
    id: "ecmwf-aifs",
    label: "ECMWF AIFS",
    cycleHours: [18, 12, 6, 0],
    availabilityLagHours: 8,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    note: "humidity's own pipeline step caps forecast hours at ~54h vs every sibling variable's 15 days. Flagged in research as a likely unresolved bug.",
    variables: [
      { id: "temperature", kind: "tile", forecastDays: 15 },
      { id: "precipitation", gcsName: "rain_accumulation", kind: "tile", forecastDays: 15 },
      { id: "solar", gcsName: "solar_ghi", kind: "tile", forecastDays: 15 },
      { id: "pressure", kind: "tile", forecastDays: 15 },
      { id: "cloud_cover", kind: "tile", forecastDays: 15 },
      { id: "humidity", kind: "tile", forecastDays: 15 },
      // Unlike plain ecmwf's wind_speed_10m/100m (which call generate_tiles_json and publish
      // both wind_data.json and PNG tiles), ecmwf-aifs/wind_speed_{10m,100m}/main.py only ever
      // imports and calls generate_grayscale_tiles -- confirmed live, no wind_data.json exists
      // at any forecast hour, only the PNG tile set. Copying ecmwf's "wind-json" kind here was
      // wrong and made every cell of both variables probe a URL that can never exist.
      { id: "wind_speed_10m", kind: "tile", forecastDays: 15 },
      { id: "wind_speed_100m", kind: "tile", forecastDays: 15 },
      windDirectionRow(15),
    ],
  },

  aigfs: {
    id: "aigfs",
    label: "AIGFS",
    cycleHours: [18, 12, 6, 0],
    availabilityLagHours: 6,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    variables: [
      { id: "temperature", kind: "tile", forecastDays: 16 },
      { id: "precipitation", kind: "tile", forecastDays: 16, startDay: 1, note: "6h-accumulation field, no f000" },
      { id: "pressure", kind: "tile", forecastDays: 16 },
      { id: "wind_speed_10m", gcsName: "wind_speed", kind: "tile", forecastDays: 16 },
      ...altitudeWindRows(16),
      windDirectionRow(16),
    ],
    extraVariables: [{ id: "humidity", note: "produced by the pipeline, not yet offered in the product for AIGFS" }],
  },

  ukmo: {
    id: "ukmo",
    label: "UKMO",
    cycleHours: [12, 0],
    availabilityLagHours: 7,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    note: "Only 00Z/12Z ingested (06Z/18Z exist upstream but only reach T+69h so the pipeline skips them) — expect a cycle-freshness gap around those hours, that's by design.",
    variables: [
      { id: "temperature", kind: "tile", forecastDays: 7 },
      { id: "precipitation", kind: "tile", forecastDays: 7 },
      { id: "humidity", kind: "tile", forecastDays: 7 },
      { id: "pressure", kind: "tile", forecastDays: 7 },
      { id: "wind_speed_10m", gcsName: "wind_speed", kind: "tile", forecastDays: 7 },
      { id: "solar", kind: "tile", forecastDays: 7 },
      { id: "cloud_cover", kind: "tile", forecastDays: 7 },
      { id: "cloud_cover_high", kind: "tile", forecastDays: 7 },
      { id: "cloud_cover_low", kind: "tile", forecastDays: 7 },
      { id: "cloud_cover_middle", kind: "tile", forecastDays: 7 },
      { id: "cape", kind: "tile", forecastDays: 7 },
      { id: "cin", kind: "tile", forecastDays: 7 },
      windDirectionRow(7),
    ],
  },

  jma: {
    id: "jma",
    label: "JMA",
    cycleHours: [12, 0],
    availabilityLagHours: 8,
    tileScoping: "date",
    hasSuccessMarker: false,
    tileZoom: 3,
    note: "No _SUCCESS marker is ever written for jma — cycle completeness can only be inferred from the tiles themselves, never from a marker check.",
    variables: [
      { id: "temperature", kind: "tile", forecastDays: 11 },
      { id: "precipitation", kind: "tile", forecastDays: 11 },
      { id: "humidity", kind: "tile", forecastDays: 11 },
      { id: "pressure", kind: "tile", forecastDays: 11 },
      { id: "cloud_cover", kind: "tile", forecastDays: 11 },
      { id: "cloud_cover_high", kind: "tile", forecastDays: 11 },
      { id: "cloud_cover_low", kind: "tile", forecastDays: 11 },
      { id: "cloud_cover_middle", kind: "tile", forecastDays: 11 },
      { id: "wind_speed_10m", gcsName: "wind_speed", kind: "tile", forecastDays: 11 },
      ...altitudeWindRows(11),
      windDirectionRow(11),
    ],
  },

  copernicusmarine: {
    id: "copernicusmarine",
    label: "CMEMS",
    cycleHours: [0],
    availabilityLagHours: 13,
    tileScoping: "cycle",
    hasSuccessMarker: true,
    tileZoom: 3,
    note:
      "Static pipeline-code research (2026-09-24) found sst/salinity/wave_period commented out of " +
      "the scheduler's VARIABLES list despite having full folders/Dockerfiles/CI, which would mean " +
      "permanent Red. The dashboard's first live run contradicted this — all three came back green, " +
      "with GCS Last-Modified timestamps within ~26 min of a confirmed-active sibling variable, i.e. " +
      "genuinely fresh output. Either re-enabled since the research, or the research was already " +
      "stale — either way, trust the dashboard's own live cells over this note.",
    variables: [
      { id: "ocean_current", kind: "ocean-json", forecastDays: 8 },
      { id: "sst", kind: "tile", forecastDays: 8 },
      { id: "salinity", kind: "tile", forecastDays: 8 },
      { id: "wave_height", kind: "tile", forecastDays: 8 },
      { id: "wave_direction", kind: "tile", forecastDays: 8 },
      { id: "wave_period", kind: "tile", forecastDays: 8 },
    ],
    extraVariables: [
      { id: "strokes_drift_x_velocity", note: "actively produced, not yet offered in the product" },
      { id: "ocean_current_vo", note: "actively produced (grayscale only, no companion JSON), not yet offered in the product" },
    ],
  },

  wfs: {
    id: "wfs",
    label: "WFS",
    cycleHours: [12, 0],
    availabilityLagHours: 8,
    tileScoping: "date",
    hasSuccessMarker: true,
    tileZoom: 2,
    note:
      "Regional India-only WRF run with no committed Cloud Scheduler config anywhere — cadence is " +
      "best-effort/unverifiable from code. Tiles are date-scoped, but a cycle-scoped _SUCCESS marker " +
      "is still written, purely so the API can learn whether a date's run was 00Z or 12Z.",
    variables: [
      { id: "precipitation", kind: "tile", forecastDays: 3 },
      // temperature/pressure/solar: NOT gcsName "t2"/"psfc"/"swdown". Those are only the
      // pipeline's own source-folder names (wfs/t2/, wfs/psfc/, wfs/swdown/) -- each folder's
      // main.py sets GCS_TILE_PREFIX = f"{MODEL}/{VARIABLE}" from its own VARIABLE constant,
      // which is "temperature"/"pressure"/"solar" respectively, not the folder name. Confirmed
      // live: wfs/temperature|pressure|solar/... all 200, wfs/t2|psfc|swdown/... all 404.
      { id: "temperature", kind: "tile", forecastDays: 3 },
      { id: "pressure", kind: "tile", forecastDays: 3 },
      { id: "solar", kind: "tile", forecastDays: 3 },
      { id: "wind_speed_10m", gcsName: "wind_speed", kind: "tile", forecastDays: 3 },
      windDirectionRow(3),
      // Previously suspected (from a source-only read of wfs/smois/main.py, which hardcodes
      // VARIABLE="soil_moisture" with no per-depth override visible) to collide all 4 depths
      // onto one GCS path. Confirmed FALSE live: wfs/soil_moisture_0_10cm, _10_40cm, _40_100cm
      // and _100_200cm are each their own distinct, populated path (all 200) -- whatever the
      // deployed pipeline actually does differs from what's in this source snapshot. No
      // gcsName override needed; each depth's plain id is already its real GCS segment.
      { id: "soil_moisture_0_10cm", kind: "tile", forecastDays: 3 },
      { id: "soil_moisture_10_40cm", kind: "tile", forecastDays: 3 },
      { id: "soil_moisture_40_100cm", kind: "tile", forecastDays: 3 },
      { id: "soil_moisture_100_200cm", kind: "tile", forecastDays: 3 },
    ],
    extraVariables: [{ id: "cldfra" }, { id: "sh2o" }, { id: "tslb" }],
  },
};

export const MODEL_IDS = Object.keys(MODEL_CONFIGS) as ModelId[];
