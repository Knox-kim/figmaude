import type { MappingWithState } from "../hooks/useSync";
import StatusBadge from "../components/StatusBadge";
import DiffViewer from "../components/DiffViewer";
import TokenDiffViewer from "../components/TokenDiffViewer";

interface DetailsViewProps {
  mapping: MappingWithState;
  onPushToCode: () => void;
  onPullFromCode: () => void;
  onBack: () => void;
  syncing: boolean;
}

export default function DetailsView({
  mapping,
  onPushToCode,
  onPullFromCode,
  onBack,
  syncing,
}: DetailsViewProps) {
  const { state } = mapping;
  const isToken = mapping.kind === "variable" || mapping.kind === "style";
  const showFigmaSide = state === "figma_changed" || state === "conflict";
  const showCodeSide = state === "code_changed" || state === "conflict";

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          &larr; Back
        </button>
        <h2 className="text-base font-semibold">
          {state === "conflict" ? "Resolve Conflict" : "Change Details"}
        </h2>
      </div>

      <div className={`rounded-lg border p-3 mb-4 ${
        state === "conflict"
          ? "border-red-200 bg-red-50"
          : state === "figma_changed"
            ? "border-blue-200 bg-blue-50"
            : "border-orange-200 bg-orange-50"
      }`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">
            {isToken && (
              <span className="text-[10px] font-normal text-gray-400 uppercase tracking-wide mr-1">
                {mapping.kind === "variable" ? "VAR" : "STY"}
              </span>
            )}
            {mapping.componentName}
          </span>
          <StatusBadge state={state} />
        </div>
        <div className="text-xs text-gray-500 font-mono">{mapping.linkedFile}</div>
      </div>

      <div className="space-y-3 mb-4">
        {showFigmaSide && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="text-xs font-medium text-blue-700 mb-1">Figma Side</div>
            {isToken && mapping.lastSyncedTokenSnapshot && mapping.tokenSnapshot ? (
              <TokenDiffViewer
                before={mapping.lastSyncedTokenSnapshot}
                after={mapping.tokenSnapshot}
              />
            ) : !isToken && mapping.lastSyncedSnapshot && mapping.currentSnapshot ? (
              <DiffViewer before={mapping.lastSyncedSnapshot} after={mapping.currentSnapshot} />
            ) : (
              <>
                <div className="text-xs text-blue-600">
                  Design has changed since last sync.
                </div>
                <div className="text-xs text-blue-400 font-mono mt-1">
                  Hash: {mapping.figmaHash.slice(0, 12)}...
                </div>
              </>
            )}
          </div>
        )}

        {showCodeSide && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
            <div className="text-xs font-medium text-orange-700 mb-1">Code Side</div>
            <div className="text-xs text-orange-600">
              Code file has changed since last sync.
            </div>
            <div className="text-xs text-orange-400 font-mono mt-1">
              SHA: {mapping.currentCodeHash.slice(0, 12)}...
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 mb-4">
        Last synced: {mapping.lastSyncedAt
          ? new Date(mapping.lastSyncedAt).toLocaleString()
          : "Never"}
        {mapping.lastSyncSource && (
          <span> (from {mapping.lastSyncSource})</span>
        )}
      </div>

      <div className="space-y-2">
        {state === "conflict" ? (
          <>
            <button
              onClick={onPushToCode}
              disabled={syncing}
              className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "Syncing..." : "Keep Figma"}
            </button>
            <button
              onClick={onPullFromCode}
              disabled={syncing}
              className="w-full rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {syncing ? "Syncing..." : "Keep Code"}
            </button>
            <p className="text-xs text-gray-400 text-center">
              Choose which side to keep. The other side will be overwritten.
            </p>
          </>
        ) : state === "figma_changed" ? (
          <button
            onClick={onPushToCode}
            disabled={syncing}
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Push to Code"}
          </button>
        ) : state === "code_changed" ? (
          <button
            onClick={onPullFromCode}
            disabled={syncing}
            className="w-full rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Pull from Code"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
