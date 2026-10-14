import { useEffect, useMemo, useRef, useState } from "react";
import {
  errorMessage,
  getExtras,
  getFeatures,
  getModel,
  getRunStatus,
  getSummary,
  postRun,
} from "./api/client";
import type { ExtraResult, FeaturesResponse, ModelDetail, SummaryResponse, VariableDetail } from "./types";
import { compareModels, matchesSearch, type SortBy } from "./lib/filters";
import { SummaryBar } from "./components/SummaryBar";
import { FilterBar } from "./components/FilterBar";
import { ModelGrid } from "./components/ModelGrid";
import { FeaturePanel } from "./components/FeaturePanel";
import { ExtrasPanel } from "./components/ExtrasPanel";
import { CellDrawer, type CellSelection } from "./components/CellDrawer";

/** Board stays live without a manual refresh — within the 15-30s range the build spec asks for. */
const POLL_MS = 20_000;

export default function App() {
  // ---- summary ----
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const lastRunAtRef = useRef<string | null>(null);

  // ---- per-model detail (fetched for every model up front — only 9 of
  // them, and having them all in hand is what lets search/sort work across
  // variables, not just model labels) ----
  const [modelDetails, setModelDetails] = useState<Record<string, ModelDetail>>({});
  const [modelDetailErrors, setModelDetailErrors] = useState<Record<string, string>>({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(new Set());

  // ---- features / extras ----
  const [features, setFeatures] = useState<FeaturesResponse | null>(null);
  const [featuresLoading, setFeaturesLoading] = useState(true);
  const [featuresError, setFeaturesError] = useState<string | null>(null);

  const [extras, setExtras] = useState<ExtraResult[] | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(true);
  const [extrasError, setExtrasError] = useState<string | null>(null);

  // ---- run control ----
  const [runInProgress, setRunInProgress] = useState(false);
  const [runTriggering, setRunTriggering] = useState(false);
  const [runTriggerError, setRunTriggerError] = useState<string | null>(null);

  // ---- filters ----
  const [modelFilter, setModelFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortBy>("severity");
  const [searchText, setSearchText] = useState("");

  // ---- drill-down drawer ----
  const [selection, setSelection] = useState<CellSelection | null>(null);

  function loadModelDetail(id: string) {
    setLoadingDetailIds((prev) => new Set(prev).add(id));
    getModel(id)
      .then((d) => {
        setModelDetails((prev) => ({ ...prev, [id]: d }));
        setModelDetailErrors((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      })
      .catch((e: unknown) => {
        setModelDetailErrors((prev) => ({ ...prev, [id]: errorMessage(e) }));
      })
      .finally(() => {
        setLoadingDetailIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  }

  function loadAllModelDetails(ids: string[]) {
    ids.forEach(loadModelDetail);
  }

  function loadFeatures() {
    setFeaturesLoading(true);
    getFeatures()
      .then((f) => {
        setFeatures(f);
        setFeaturesError(null);
      })
      .catch((e: unknown) => setFeaturesError(errorMessage(e)))
      .finally(() => setFeaturesLoading(false));
  }

  function loadExtras() {
    setExtrasLoading(true);
    getExtras()
      .then((e) => {
        setExtras(e);
        setExtrasError(null);
      })
      .catch((e: unknown) => setExtrasError(errorMessage(e)))
      .finally(() => setExtrasLoading(false));
  }

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    getSummary()
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setSummaryError(null);
        lastRunAtRef.current = s.lastRunAt;
        setRunInProgress(s.runInProgress);
        loadAllModelDetails(s.models.map((m) => m.id));
      })
      .catch((e: unknown) => {
        if (!cancelled) setSummaryError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    loadFeatures();
    loadExtras();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recurring poll: /api/summary + /api/run/status every POLL_MS. When
  // lastRunAt actually moves (a sweep completed), refresh everything else
  // too — model details, features, and extras can only change right after
  // a run finishes.
  useEffect(() => {
    const id = setInterval(() => {
      Promise.allSettled([getSummary(), getRunStatus()]).then(([sRes, rsRes]) => {
        if (sRes.status === "fulfilled") {
          const s = sRes.value;
          setSummary(s);
          setSummaryError(null);
          if (s.lastRunAt !== lastRunAtRef.current) {
            lastRunAtRef.current = s.lastRunAt;
            loadAllModelDetails(s.models.map((m) => m.id));
            loadFeatures();
            loadExtras();
          }
        } else {
          setSummaryError(errorMessage(sRes.reason));
        }
        if (rsRes.status === "fulfilled") {
          setRunInProgress(rsRes.value.runInProgress);
        }
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleRunNow() {
    setRunTriggerError(null);
    setRunTriggering(true);
    try {
      const res = await postRun();
      if (res.started) {
        setRunInProgress(true);
      } else {
        setRunTriggerError(res.reason ?? "The server declined to start a run.");
      }
    } catch (e) {
      setRunTriggerError(errorMessage(e));
    } finally {
      setRunTriggering(false);
    }
  }

  function handleCellClick(modelId: string, modelLabel: string, variable: VariableDetail, day: number) {
    setSelection({ modelId, modelLabel, variable, day });
  }

  function resetFilters() {
    setModelFilter("all");
    setSearchText("");
  }

  const visibleModels = useMemo(() => {
    if (!summary) return [];
    let list = summary.models;
    if (modelFilter !== "all") {
      list = list.filter((m) => m.id === modelFilter);
    }
    if (searchText.trim()) {
      list = list.filter((m) => {
        if (matchesSearch(searchText, m.label, m.id)) return true;
        const detail = modelDetails[m.id];
        return detail ? detail.variables.some((v) => matchesSearch(searchText, v.id, v.gcsName, v.label)) : false;
      });
    }
    return [...list].sort((a, b) => compareModels(a, b, modelDetails, sortBy));
  }, [summary, modelFilter, searchText, sortBy, modelDetails]);

  const isFiltered = modelFilter !== "all" || searchText.trim() !== "";

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <SummaryBar
          summary={summary}
          summaryLoading={summaryLoading}
          summaryError={summaryError}
          runInProgress={runInProgress}
          runTriggering={runTriggering}
          runTriggerError={runTriggerError}
          onRunNow={handleRunNow}
        />

        <FilterBar
          modelOptions={(summary?.models ?? []).map((m) => ({ id: m.id, label: m.label }))}
          modelFilter={modelFilter}
          onModelFilterChange={setModelFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          onClear={resetFilters}
          isFiltered={isFiltered}
        />

        <ModelGrid
          models={visibleModels}
          totalModelsCount={summary?.models.length ?? 0}
          details={modelDetails}
          detailErrors={modelDetailErrors}
          loadingDetailIds={loadingDetailIds}
          searchText={searchText}
          sortBy={sortBy}
          onCellClick={handleCellClick}
          onRetryDetail={loadModelDetail}
          onClearFilters={resetFilters}
        />

        <FeaturePanel data={features} loading={featuresLoading} error={featuresError} onRetry={loadFeatures} />

        <ExtrasPanel data={extras} loading={extrasLoading} error={extrasError} onRetry={loadExtras} />
      </main>

      <CellDrawer selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}
