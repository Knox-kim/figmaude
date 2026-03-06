import type { SyncState } from "../../shared/types";

interface ComponentCardProps {
  kind: "component" | "style" | "variable";
  componentName: string;
  state: SyncState;
  onForceSyncFigma: () => void;
  onForceSyncCode: () => void;
  onShowDetails?: () => void;
  syncing: boolean;
  progressMessage?: string;
}

export default function ComponentCard({
  kind,
  componentName,
  state,
  onForceSyncFigma,
  onForceSyncCode,
  onShowDetails,
  syncing,
  progressMessage,
}: ComponentCardProps) {
  const pushEnabled = state === "figma_changed" || state === "conflict" || state === "newly_linked" || state === "figma_only";
  const pullEnabled = state === "code_changed" || state === "conflict" || state === "newly_linked" || state === "code_only";

  return (
    <tr>
      <td className="border border-gray-200 px-3 py-3">
        <div className="flex flex-col items-center justify-center h-full">
          <div className="flex-1" />
          <button
            onClick={onForceSyncFigma}
            disabled={!pushEnabled || syncing}
            className={`text-xs font-medium rounded px-3 py-1 whitespace-nowrap ${
              pushEnabled && !syncing
                ? "bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-800 cursor-pointer"
                : "text-gray-300 cursor-default"
            }`}
          >
            Push to Code
          </button>
          <div className="flex-1">
            {pushEnabled && onShowDetails && !syncing && !progressMessage && (
              <button
                onClick={onShowDetails}
                className="text-[10px] text-gray-400 hover:text-gray-600 underline mt-1 block mx-auto"
              >
                Details
              </button>
            )}
          </div>
        </div>
      </td>
      <td className="border border-gray-200 px-3 py-3 text-center align-middle">
        <div className="font-semibold text-sm mb-1">
          {componentName}
        </div>
        {progressMessage && (
          <div className="text-xs text-blue-500 mt-1 animate-pulse">{progressMessage}</div>
        )}
      </td>
      <td className="border border-gray-200 px-3 py-3">
        <div className="flex flex-col items-center justify-center h-full">
          <div className="flex-1" />
          <button
            onClick={onForceSyncCode}
            disabled={!pullEnabled || syncing}
            className={`text-xs font-medium rounded px-3 py-1 whitespace-nowrap ${
              pullEnabled && !syncing
                ? "bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-800 cursor-pointer"
                : "text-gray-300 cursor-default"
            }`}
          >
            Pull from Code
          </button>
          <div className="flex-1">
            {pullEnabled && onShowDetails && !syncing && !progressMessage && (
              <button
                onClick={onShowDetails}
                className="text-[10px] text-gray-400 hover:text-gray-600 underline mt-1 block mx-auto"
              >
                Details
              </button>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
