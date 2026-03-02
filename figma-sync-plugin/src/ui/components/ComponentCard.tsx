import type { SyncState } from "../../shared/types";
import StatusBadge from "./StatusBadge";

interface ComponentCardProps {
  componentName: string;
  codePath: string;
  state: SyncState;
  onUnlink: () => void;
  onMarkSynced: () => void;
  onForceSyncFigma: () => void;
  onForceSyncCode: () => void;
  onResolveConflict?: () => void;
  syncing: boolean;
}

export default function ComponentCard({
  componentName,
  codePath,
  state,
  onUnlink,
  onMarkSynced,
  onForceSyncFigma,
  onForceSyncCode,
  onResolveConflict,
  syncing,
}: ComponentCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{componentName}</span>
        <StatusBadge state={state} />
      </div>
      <div className="text-xs text-gray-500 mb-2 font-mono">{codePath}</div>
      <div className="flex items-center gap-2">
        {(state === "figma_changed" || state === "code_changed") && (
          <button
            onClick={onMarkSynced}
            disabled={syncing}
            className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Mark as Synced"}
          </button>
        )}
        {state === "conflict" && (
          <button
            onClick={onResolveConflict}
            className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Resolve
          </button>
        )}
        <button
          onClick={onUnlink}
          className="text-xs text-red-500 hover:text-red-700 ml-auto"
        >
          Unlink
        </button>
      </div>
    </div>
  );
}
