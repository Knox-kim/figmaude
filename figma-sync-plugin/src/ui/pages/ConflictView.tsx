import type { MappingWithState } from "../hooks/useSync";
import StatusBadge from "../components/StatusBadge";

interface ConflictViewProps {
  mapping: MappingWithState;
  onKeepFigma: () => void;
  onKeepCode: () => void;
  onBack: () => void;
  syncing: boolean;
}

export default function ConflictView({
  mapping,
  onKeepFigma,
  onKeepCode,
  onBack,
  syncing,
}: ConflictViewProps) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          &larr; Back
        </button>
        <h2 className="text-base font-semibold">Resolve Conflict</h2>
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">{mapping.componentName}</span>
          <StatusBadge state="conflict" />
        </div>
        <div className="text-xs text-gray-500 font-mono">{mapping.linkedFile}</div>
      </div>

      <div className="space-y-3 mb-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-xs font-medium text-blue-700 mb-1">Figma Side</div>
          <div className="text-xs text-blue-600">
            Design has changed since last sync.
          </div>
          <div className="text-xs text-blue-400 font-mono mt-1">
            Hash: {mapping.figmaHash.slice(0, 12)}...
          </div>
        </div>

        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="text-xs font-medium text-orange-700 mb-1">Code Side</div>
          <div className="text-xs text-orange-600">
            Code file has changed since last sync.
          </div>
          <div className="text-xs text-orange-400 font-mono mt-1">
            SHA: {mapping.currentCodeHash.slice(0, 12)}...
          </div>
        </div>
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
        <button
          onClick={onKeepFigma}
          disabled={syncing}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Keep Figma"}
        </button>
        <button
          onClick={onKeepCode}
          disabled={syncing}
          className="w-full rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Keep Code"}
        </button>
        <p className="text-xs text-gray-400 text-center">
          Use Claude Code with Figma MCP to merge both sides.
        </p>
      </div>
    </div>
  );
}
