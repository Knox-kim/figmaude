import type { SyncState } from "../../shared/types";
import StatusBadge from "./StatusBadge";

interface ComponentCardProps {
  componentName: string;
  codePath: string;
  state: SyncState;
  onUnlink: () => void;
}

export default function ComponentCard({
  componentName,
  codePath,
  state,
  onUnlink,
}: ComponentCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{componentName}</span>
        <StatusBadge state={state} />
      </div>
      <div className="text-xs text-gray-500 mb-2 font-mono">{codePath}</div>
      <div className="flex gap-2">
        <button
          onClick={onUnlink}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Unlink
        </button>
      </div>
    </div>
  );
}
