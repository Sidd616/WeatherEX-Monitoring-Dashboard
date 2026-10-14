// Cron-driven scheduling for both tiers, plus the manual-trigger path used by POST /api/run.
// A single in-memory `runInProgress` flag guards all three entry points (matrix cron tick,
// feature cron tick, manual full run) — whichever gets there first wins, the rest no-op and log
// rather than stack. Matrix and feature sweeps run on independent cadences (matrix is the
// expensive one at 30 min default, features are cheap and check every 10 min default) since
// that's the whole point of having two intervals; POST /api/run and the startup pass are the
// only paths that run both together as a single "full run".

import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { finishRun, getOverallCounts, startRun } from "./db/db.js";
import { runFeatureSweep } from "./checks/featureRunner.js";
import { runMatrixSweep } from "./checks/matrixRunner.js";

let runInProgress = false;

export function isRunInProgress(): boolean {
  return runInProgress;
}

export type RunTrigger = { started: true; runId: string } | { started: false; reason: string };

/**
 * Starts `work` in the background under the shared overlap guard and returns immediately with
 * whether it actually started — the caller (an HTTP handler or a cron tick) does not wait for
 * the sweep itself to finish. DB/flag bookkeeping happens when `work` eventually settles.
 */
function startRunInBackground(label: string, work: () => Promise<void>): RunTrigger {
  if (runInProgress) {
    console.log(`[scheduler] ${label} skipped — a run is already in progress`);
    return { started: false, reason: "already running" };
  }

  runInProgress = true;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  startRun(runId, startedAt);
  console.log(`[scheduler] ${label} (run ${runId}) started at ${startedAt}`);

  work()
    .then(() => {
      const counts = getOverallCounts();
      const finishedAt = new Date().toISOString();
      finishRun(runId, finishedAt, counts);
      const seconds = ((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000).toFixed(1);
      console.log(
        `[scheduler] ${label} (run ${runId}) finished in ${seconds}s -- ` +
          `green=${counts.green} yellow=${counts.yellow} red=${counts.red} gray=${counts.gray}`
      );
    })
    .catch((err: unknown) => {
      console.error(`[scheduler] ${label} (run ${runId}) failed:`, err);
      finishRun(runId, new Date().toISOString(), getOverallCounts());
    })
    .finally(() => {
      runInProgress = false;
    });

  return { started: true, runId };
}

export function runMatrixJob(): RunTrigger {
  return startRunInBackground("matrix sweep", runMatrixSweep);
}

export function runFeaturesJob(): RunTrigger {
  return startRunInBackground("feature sweep", runFeatureSweep);
}

export function runFullJob(): RunTrigger {
  return startRunInBackground("full run", async () => {
    await Promise.all([runMatrixSweep(), runFeatureSweep()]);
  });
}

export function startScheduler(): void {
  const matrixMinutes = Number(process.env.MATRIX_INTERVAL_MINUTES ?? 30);
  const featuresMinutes = Number(process.env.FEATURES_INTERVAL_MINUTES ?? 10);

  cron.schedule(`*/${matrixMinutes} * * * *`, () => {
    runMatrixJob();
  });
  cron.schedule(`*/${featuresMinutes} * * * *`, () => {
    runFeaturesJob();
  });

  console.log(`[scheduler] matrix sweep every ${matrixMinutes}m, feature sweep every ${featuresMinutes}m`);

  // Initial pass of both immediately on startup so the dashboard isn't empty until the first
  // cron tick.
  runFullJob();
}
