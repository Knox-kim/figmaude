import type { SyncState, FlatSnapshot } from "../../shared/types";
import StatusBadge from "./StatusBadge";
import { summarizeChanges } from "./DiffViewer";

interface ComponentCardProps {
  kind: "component" | "style" | "variable";
  componentName: string;
  state: SyncState;
  lastSyncedSnapshot?: FlatSnapshot;
  currentSnapshot?: FlatSnapshot;
  onForceSyncFigma: () => void;
  onForceSyncCode: () => void;
  onResolveConflict?: () => void;
  syncing: boolean;
  progressMessage?: string;
}

export default function ComponentCard({
  kind,
  componentName,
  state,
  lastSyncedSnapshot,
  currentSnapshot,
  onForceSyncFigma,
  onForceSyncCode,
  onResolveConflict,
  syncing,
  progressMessage,
}: ComponentCardProps) {
  const pushEnabled = state === "figma_changed" || state === "conflict";
  const pullEnabled = state === "code_changed" || state === "conflict";

  const changeSummary =
    (state === "figma_changed" || state === "conflict") &&
    lastSyncedSnapshot &&
    currentSnapshot
      ? summarizeChanges(lastSyncedSnapshot, currentSnapshot)
      : null;

  return (
    <tr>
      <td className="border border-gray-200 px-3 py-3 text-center align-middle">
        <button
          onClick={onForceSyncFigma}
          disabled={!pushEnabled || syncing}
          className={`text-xs font-medium ${
            pushEnabled && !syncing
              ? "text-blue-600 hover:text-blue-800 cursor-pointer"
              : "text-gray-300 cursor-default"
          }`}
        >
          Push to Code
        </button>
      </td>
      <td className="border border-gray-200 px-3 py-3 text-center align-middle">
        <div className="font-semibold text-sm mb-1">
          {kind !== "component" && (
            <span className="text-[10px] font-normal text-gray-400 uppercase tracking-wide mr-1">
              {kind === "variable" ? "VAR" : "STY"}
            </span>
          )}
          {componentName}
        </div>
        <StatusBadge state={state} />
        {progressMessage && (
          <div className="text-xs text-blue-500 mt-1 animate-pulse">{progressMessage}</div>
        )}
        {changeSummary && !progressMessage && (
          <div className="text-xs text-amber-600 mt-1">{changeSummary}</div>
        )}
        {state === "conflict" && onResolveConflict && !progressMessage && (
          <button
            onClick={onResolveConflict}
            className="text-xs text-red-500 hover:text-red-700 mt-1 block mx-auto"
          >
            View Diff
          </button>
        )}
      </td>
      <td className="border border-gray-200 px-3 py-3 text-center align-middle">
        <button
          onClick={onForceSyncCode}
          disabled={!pullEnabled || syncing}
          className={`text-xs font-medium ${
            pullEnabled && !syncing
              ? "text-purple-600 hover:text-purple-800 cursor-pointer"
              : "text-gray-300 cursor-default"
          }`}
        >
          Pull from Code
        </button>
      </td>
    </tr>
  );
}
