import type { SyncState } from "../../shared/types";

const config: Record<SyncState, { label: string; color: string }> = {
  synced: { label: "Synced", color: "bg-green-100 text-green-700" },
  figma_changed: { label: "Figma changed", color: "bg-amber-100 text-amber-700" },
  code_changed: { label: "Code changed", color: "bg-orange-100 text-orange-700" },
  conflict: { label: "Conflict", color: "bg-red-100 text-red-700" },
  newly_linked: { label: "Newly linked", color: "bg-blue-100 text-blue-700" },
  not_linked: { label: "Not linked", color: "bg-gray-100 text-gray-500" },
};

export default function StatusBadge({ state }: { state: SyncState }) {
  const { label, color } = config[state];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${color}`}>
      {label}
    </span>
  );
}
