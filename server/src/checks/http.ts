// Thin, non-throwing fetch wrappers shared by both tiers of checks, plus a hand-rolled
// concurrency limiter (no p-limit-style dependency needed for ~15 lines of queueing logic).
// This is the one place actual outbound network calls happen — keeping the limiter here means
// every caller gets bounded concurrency for free, with no risk of an unbounded fan-out ever
// hitting the real platform like a DoS.

const CHECK_CONCURRENCY = Number(process.env.CHECK_CONCURRENCY ?? 24);
const TIMEOUT_MS = 8000;

let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < CHECK_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "AbortError" ? `timed out after ${TIMEOUT_MS}ms` : err.message;
  }
  return String(err);
}

export interface HeadCheckResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** HEAD a URL. Never throws — network errors and timeouts land in `error` instead. */
export function headCheck(url: string): Promise<HeadCheckResult> {
  return withLimit(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      return { ok: res.ok, status: res.status, error: null };
    } catch (err) {
      return { ok: false, status: null, error: describeError(err) };
    } finally {
      clearTimeout(timer);
    }
  });
}

export interface GetJsonResult {
  ok: boolean;
  status: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  error: string | null;
}

/** GET a URL and parse its JSON body. Never throws — network errors, timeouts, and JSON parse
 * failures all land in `error` instead (with `json: null` for the latter two). */
export function getJson(url: string): Promise<GetJsonResult> {
  return withLimit(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "GET", signal: controller.signal });
      try {
        const json = await res.json();
        return { ok: res.ok, status: res.status, json, error: null };
      } catch (parseErr) {
        return { ok: res.ok, status: res.status, json: null, error: `invalid JSON response: ${describeError(parseErr)}` };
      }
    } catch (err) {
      return { ok: false, status: null, json: null, error: describeError(err) };
    } finally {
      clearTimeout(timer);
    }
  });
}
