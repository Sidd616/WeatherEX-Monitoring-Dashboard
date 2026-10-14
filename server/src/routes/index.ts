// REST contract for the web/ dashboard. See PLAN.md section 4 for the contract summary; the
// exact shapes here are the authoritative version (per the build spec).

import { Router } from "express";
import { MODEL_CONFIGS, MODEL_IDS } from "../config/models.js";
import {
  emptyCounts,
  getAllFeatures,
  getCell,
  getCellsForVariable,
  getCountsByModel,
  getLastFinishedRun,
  getMarker,
  getOverallCounts,
} from "../db/db.js";
import { isRunInProgress, runFullJob } from "../scheduler.js";
import type { ExtraResult } from "../types.js";

export const router = Router();

router.get("/summary", (_req, res) => {
  const countsByModel = getCountsByModel();
  const models = MODEL_IDS.map((id) => {
    const model = MODEL_CONFIGS[id];
    return {
      id: model.id,
      label: model.label,
      counts: countsByModel[id] ?? emptyCounts(),
    };
  });

  res.json({
    lastRunAt: getLastFinishedRun()?.finishedAt ?? null,
    runInProgress: isRunInProgress(),
    counts: getOverallCounts(),
    models,
  });
});

router.get("/models/:model", (req, res) => {
  const model = MODEL_CONFIGS[req.params.model as keyof typeof MODEL_CONFIGS];
  if (!model) {
    res.status(404).json({ success: false, error: `unknown model: ${req.params.model}` });
    return;
  }

  const variables = model.variables.map((variable) => {
    const marker = model.hasSuccessMarker ? getMarker(model.id, variable.id) : undefined;
    const cells = getCellsForVariable(model.id, variable.id).map((c) => ({
      day: c.day,
      status: c.status,
      checkedAt: c.checkedAt,
    }));

    return {
      id: variable.id,
      label: variable.label,
      kind: variable.kind,
      gcsName: variable.gcsName,
      forecastDays: variable.forecastDays,
      startDay: variable.startDay ?? 0,
      dailyRange: variable.dailyRange,
      knownGap: variable.knownGap,
      note: variable.note,
      markerPresent: marker ? marker.present : null,
      cells,
    };
  });

  res.json({
    id: model.id,
    label: model.label,
    note: model.note,
    variables,
  });
});

router.get("/cell/:model/:variable/:day", (req, res) => {
  const day = Number(req.params.day);
  const cell = Number.isInteger(day) ? getCell(req.params.model, req.params.variable, day) : undefined;
  if (!cell) {
    res.status(404).json({ success: false, error: "cell not found -- it may not have been checked yet" });
    return;
  }
  res.json(cell);
});

router.get("/features", (_req, res) => {
  const features = getAllFeatures();
  const checkedAt = features.reduce<string | null>((latest, f) => {
    return !latest || f.checkedAt > latest ? f.checkedAt : latest;
  }, null);
  res.json({ checkedAt, features });
});

router.get("/extras", (_req, res) => {
  const extras: ExtraResult[] = [];
  for (const id of MODEL_IDS) {
    const model = MODEL_CONFIGS[id];
    for (const extra of model.extraVariables ?? []) {
      extras.push({ model: model.id, variableId: extra.id, note: extra.note });
    }
  }
  res.json(extras);
});

router.post("/run", (_req, res) => {
  const result = runFullJob();
  res.json(result);
});

router.get("/run/status", (_req, res) => {
  res.json({
    runInProgress: isRunInProgress(),
    lastRunAt: getLastFinishedRun()?.finishedAt ?? null,
  });
});
