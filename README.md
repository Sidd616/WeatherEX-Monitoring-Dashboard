# WeatherEX Monitoring Dashboard

Standalone health dashboard for the WeatherEX platform. Independently probes every
model x variable x forecast-day combination the product promises (via public GCS
+ the public API — no credentials needed), plus the non-model features (cyclones,
airports, webcams, satellite, chatbot), and reports Green / Yellow (fallback) /
Red (broken) / Gray (check failed) so a supervisor can see what needs attention
without clicking through the product by hand.

See [PLAN.md](PLAN.md) for the full design, the research findings behind it, and
the list of known/standing gaps the first run is expected to surface.

## Run locally

```
npm install
npm run dev
```

- `server` (Express + node-cron + built-in `node:sqlite`) on http://localhost:4000
- `web` (Vite + React) on http://localhost:5173, proxying `/api` to the server

No GCP credentials required — every check is a plain HTTPS request against public
GCS objects and the public `api.weatherex.ai` API.
