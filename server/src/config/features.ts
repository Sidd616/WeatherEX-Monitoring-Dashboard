// Tier 2 — platform features that aren't shaped like model x variable x day:
// no forecast-hour axis, existence + freshness instead. Each hits the public
// API (never raw GCS) because these all have a `stale`/`generatedAt`-style
// freshness signal baked into the JSON response that's more meaningful than a
// bare file-exists check (see platform-api-server's JsonSource pattern).

export type FreshnessField = "stale" | "obsStale";

export interface FeatureCheckDef {
  id: string;
  label: string;
  /** Path relative to the API base (https://api.weatherex.ai). */
  apiPath: string;
  /** Dot-path into the JSON response's `data` object holding a boolean staleness flag, if any. */
  freshnessField?: FreshnessField;
  /** Human-readable cadence, for the UI only — not used in the check itself. */
  cadence?: string;
  /** Already-confirmed-broken by research, not a transient failure. The UI badges these instead
   * of raising them as a fresh alert. */
  knownGap?: string;
}

export const FEATURE_CHECKS: FeatureCheckDef[] = [
  {
    id: "cyclones",
    label: "Cyclones",
    apiPath: "/public/cyclones?full=1",
    freshnessField: "stale",
    cadence: "pipeline republishes every 15 min; API treats it stale after 45 min",
  },
  {
    id: "airports",
    label: "Airports (catalog + METAR/TAF)",
    apiPath: "/public/airports/meta",
    freshnessField: "obsStale",
    cadence: "catalog daily 03:17 UTC; obs every 5 min, stale after 2h",
  },
  {
    id: "webcams",
    label: "Webcams",
    apiPath: "/public/webcams",
    cadence: "static curated catalog, no GCS/TileDB dependency",
  },
  {
    id: "map-tiles-meta",
    label: "Satellite / GeoColor frame inventory",
    apiPath: "/public/map-tiles/meta",
    cadence: "GeoColor frames every 15 min",
  },
  {
    id: "mosdac",
    label: "MOSDAC satellite proxy",
    apiPath: "/public/mosdac-current-url",
    cadence: "best-effort: exact expected params unconfirmed by research, treat as a smoke test",
  },
  {
    id: "chatbot-health",
    label: "Chatbot liveness",
    apiPath: "/chatbot/health",
    cadence: "trivial liveness only, not a real dependency check",
  },
  {
    id: "lightning",
    label: "Live lightning relay",
    apiPath: "/public/lightning/recent?minutes=5",
    knownGap:
      "platform-frontend calls this route but it does not exist anywhere in platform-api-server " +
      "(confirmed by full-repo grep). Either removed since the 2026-07-13 memory of it being added, " +
      "or served by a relay service outside this workspace. Confirm with the team.",
  },
  {
    id: "wave-velocity",
    label: "Wave velocity JSON (copernicusmarine)",
    apiPath: "/public/wave-velocity/copernicusmarine/f000",
    knownGap: "confirmed stub in platform-api-server — always returns \"not implemented yet\".",
  },
];
