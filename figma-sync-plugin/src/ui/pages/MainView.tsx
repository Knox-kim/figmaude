import type { GlobalConfig } from "../../shared/types";
import { useSync } from "../hooks/useSync";
import { useSyncActions } from "../hooks/useSyncActions";
import ComponentCard from "../components/ComponentCard";

interface MainViewProps {
  config: GlobalConfig;
  onSettings: () => void;
  onShowDetails: (nodeId: string) => void;
}

export default function MainView({ config, onSettings, onShowDetails }: MainViewProps) {
  const { mappings, loading, error, autoLinkedCount, refresh } = useSync(config);
  const { syncingId, actionError, progress, handleForceSyncFigma, handleForceSyncCode } = useSyncActions(config, refresh);

  const displayError = error || actionError;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-base font-semibold">Figma Sync</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="rounded border border-gray-300 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            title="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
          <button onClick={onSettings} className="text-gray-400 hover:text-gray-600 text-lg">
            &#9881;
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-4">
        {config.repoOwner}/{config.repoName} &middot; {config.branch}
      </div>

      {autoLinkedCount > 0 && (
        <div className="mb-3 rounded bg-green-50 p-2 text-xs text-green-700">
          Auto-linked {autoLinkedCount} component{autoLinkedCount > 1 ? "s" : ""} by name match
        </div>
      )}

      {displayError && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{displayError}</div>
      )}

      {loading ? (
        <div className="text-center text-sm text-gray-400 py-8">Loading...</div>
      ) : mappings.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-8">
          No linked components yet.
        </div>
      ) : (
        <table className="w-full table-fixed border-collapse border border-gray-200 text-xs mb-4">
          <thead>
            <tr>
              <th className="border border-gray-200 px-3 py-2 text-center font-medium text-gray-500 bg-gray-50 w-[30%]">Figma Comp</th>
              <th className="border border-gray-200 px-3 py-2 text-center font-medium text-gray-500 bg-gray-50 w-[40%]">Component</th>
              <th className="border border-gray-200 px-3 py-2 text-center font-medium text-gray-500 bg-gray-50 w-[30%]">Github Repo.</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => {
              const stableId = m.nodeId || m.linkedFile;
              return (
              <ComponentCard
                key={stableId}
                kind={m.kind ?? "component"}
                componentName={m.componentName}
                state={m.state}
                syncing={syncingId === stableId}
                progressMessage={progress?.nodeId === stableId ? progress.message : undefined}
                onForceSyncFigma={() => handleForceSyncFigma(m)}
                onForceSyncCode={() => handleForceSyncCode(m)}
                onShowDetails={m.nodeId ? () => onShowDetails(m.nodeId) : undefined}
              />
              );
            })}
          </tbody>
        </table>
      )}

    </div>
  );
}
