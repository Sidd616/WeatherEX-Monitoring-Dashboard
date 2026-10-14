// Thin typed fetch wrappers for the monitoring server's REST API. Every
// call goes through `apiFetch`, which normalizes network failures and
// non-2xx responses into a single `ApiError` so callers can render one
// consistent "can't reach the server" state instead of juggling fetch's
// two different failure modes (rejected promise vs. resolved-but-not-ok).

import type {
  CellDetail,
  ExtraResult,
  FeaturesResponse,
  ModelDetail,
  RunResponse,
  RunStatusResponse,
  SummaryResponse,
} from "../types";

export class ApiError extends Error {
  /** HTTP status code, when the request reached the server but failed there. Undefined for network-level failures (server unreachable, timeout, CORS). */
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    // fetch only rejects on network-level failure (server down, DNS,
    // CORS, offline) — never on a non-2xx HTTP response.
    throw new ApiError(
      "Could not reach the monitoring server. It may not be running yet.",
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // response body wasn't readable; fall back to the status alone
    }
    throw new ApiError(
      `Request to ${path} failed (${res.status} ${res.statusText})${
        detail ? `: ${detail.slice(0, 300)}` : ""
      }`,
      res.status,
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`Response from ${path} was not valid JSON.`, res.status);
  }
}

export function getSummary(): Promise<SummaryResponse> {
  return apiFetch<SummaryResponse>("/summary");
}

export function getModel(modelId: string): Promise<ModelDetail> {
  return apiFetch<ModelDetail>(`/models/${encodeURIComponent(modelId)}`);
}

export function getCell(
  model: string,
  variable: string,
  day: number,
): Promise<CellDetail> {
  return apiFetch<CellDetail>(
    `/cell/${encodeURIComponent(model)}/${encodeURIComponent(variable)}/${day}`,
  );
}

export function getFeatures(): Promise<FeaturesResponse> {
  return apiFetch<FeaturesResponse>("/features");
}

export function getExtras(): Promise<ExtraResult[]> {
  return apiFetch<ExtraResult[]>("/extras");
}

export function postRun(): Promise<RunResponse> {
  return apiFetch<RunResponse>("/run", { method: "POST" });
}

export function getRunStatus(): Promise<RunStatusResponse> {
  return apiFetch<RunStatusResponse>("/run/status");
}

/** Extracts a human-readable message from anything a catch block might see. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
