import type { GlobalConfig } from "../../shared/types";
import { useSync } from "../hooks/useSync";
import { useSyncActions } from "../hooks/useSyncActions";
import ComponentCard from "../components/ComponentCard";

interface MainViewProps {
  config: GlobalConfig;
  onLinkNew: () => void;
  onSettings: () => void;
  onConflict: (nodeId: string) => void;
}

export default function MainView({ config, onLinkNew, onSettings, onConflict }: MainViewProps) {
  const { mappings, loading, error, refresh } = useSync(config);
  const { syncingId, actionError, handleUnlink, handleMarkSynced, handleForceSyncFigma, handleForceSyncCode } = useSyncActions(refresh);

  const displayError = error || actionError;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-base font-semibold">Figma Sync</h1>
        <button onClick={onSettings} className="text-gray-400 hover:text-gray-600 text-lg">
          &#9881;
        </button>
      </div>

      <div className="text-xs text-gray-500 mb-4">
        {config.repoOwner}/{config.repoName} &middot; {config.branch}
      </div>

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
        <div className="mb-4">
          {mappings.map((m) => (
            <ComponentCard
              key={m.nodeId}
              componentName={m.componentName}
              codePath={m.linkedFile}
              state={m.state}
              lastSyncedSnapshot={m.lastSyncedSnapshot}
              currentSnapshot={m.currentSnapshot}
              syncing={syncingId === m.nodeId}
              onUnlink={() => handleUnlink(m.nodeId)}
              onMarkSynced={() => handleMarkSynced(m)}
              onForceSyncFigma={() => handleForceSyncFigma(m)}
              onForceSyncCode={() => handleForceSyncCode(m)}
              onResolveConflict={() => onConflict(m.nodeId)}
            />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onLinkNew}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Link Component
        </button>
        <button
          onClick={refresh}
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
