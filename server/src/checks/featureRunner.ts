// Tier 2: platform features that aren't shaped like model x variable x day — existence +
// freshness against the public API instead of raw GCS. See PLAN.md 2.4 for why this tier reads
// the JSON payload rather than trusting HTTP status: /public/point et al. swallow missing data
// into HTTP 200 success:true, value:null, and error_response() defaults to HTTP 400 even for
// unexpected internal exceptions — so status codes alone are not trustworthy here.

import { FEATURE_CHECKS, type FeatureCheckDef } from "../config/features.js";
import { upsertFeature } from "../db/db.js";
import type { FeatureResult, Status } from "../types.js";
import { getJson } from "./http.js";

const API_BASE_URL = process.env.API_BASE_URL ?? "https://api.weatherex.ai";

async function checkFeature(f: FeatureCheckDef): Promise<void> {
  const url = `${API_BASE_URL}${f.apiPath}`;
  const res = await getJson(url);
  const checkedAt = new Date().toISOString();

  let status: Status;
  let freshnessFlag: boolean | undefined;
  let errorMessage: string | undefined;

  if (res.status === null) {
    // Request itself failed or timed out -> gray, regardless of feature shape.
    status = "gray";
    errorMessage = res.error ?? "request failed";
  } else if (f.id === "chatbot-health") {
    // Special shape: {ok: true}, not the {success, data} envelope.
    if (res.json === null) {
      status = "gray";
      errorMessage = res.error ?? "response body was not valid JSON";
    } else {
      status = res.json.ok === true ? "green" : "red";
    }
  } else if (res.status === 503) {
    // JsonSource "never loaded" case (cyclones/airports) -- explicitly red regardless of body.
    status = "red";
    errorMessage = res.error ?? "HTTP 503";
  } else if (res.status < 200 || res.status >= 300) {
    // Any other non-2xx status is a clean, confirmed failure regardless of body shape -- e.g. a
    // route that doesn't exist at all (lightning, per PLAN.md 2.3) can 404 with a generic HTML
    // error page from in front of the app, not this backend's {success:false} JSON envelope. The
    // status code alone already tells the story; gray is reserved for cases where we genuinely
    // couldn't get a clean read at all (transport failure, or a 2xx with an unparseable body).
    status = "red";
    errorMessage = res.json && typeof res.json.error === "string" ? res.json.error : res.error ?? `HTTP ${res.status}`;
  } else if (res.json === null) {
    // 2xx status but a body we can't parse -- transport succeeded, but we can't confirm the
    // app-level contract was satisfied, so this is a genuine "couldn't cleanly determine".
    status = "gray";
    errorMessage = res.error ?? "response body was not valid JSON";
  } else if (res.json.success === false) {
    // Trust the JSON body over the HTTP status here too (belt-and-suspenders: error_response()
    // can pair success:false with a 2xx in some paths -- see file header).
    status = "red";
    errorMessage = typeof res.json.error === "string" ? res.json.error : "success:false";
  } else if (f.freshnessField && res.json.data?.[f.freshnessField] === true) {
    status = "yellow";
    freshnessFlag = true;
  } else {
    status = "green";
    if (f.freshnessField) freshnessFlag = false;
  }

  const result: FeatureResult = {
    id: f.id,
    label: f.label,
    status,
    httpStatus: res.status ?? undefined,
    freshnessFlag,
    knownGap: f.knownGap,
    checkedAt,
    errorMessage,
  };

  upsertFeature(result);
}

export async function runFeatureSweep(): Promise<void> {
  await Promise.all(FEATURE_CHECKS.map(checkFeature));
}
