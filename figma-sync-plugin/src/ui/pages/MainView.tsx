import { useState, useEffect } from "react";
import type { MappingEntry, SyncState, GlobalConfig } from "../../shared/types";
import { requestToPlugin } from "../lib/messenger";
import { getFileShas } from "../lib/github";
import ComponentCard from "../components/ComponentCard";

interface MappingWithState extends MappingEntry {
  state: SyncState;
}

interface MainViewProps {
  config: GlobalConfig;
  onLinkNew: () => void;
  onSettings: () => void;
}

function computeState(mapping: MappingEntry, currentCodeHash: string): SyncState {
  const figmaChanged = mapping.figmaHash !== mapping.lastSyncedHash;

  // Code changed = current GitHub SHA differs from what was stored at last sync
  // If codeHash was never set, current code is the baseline (not changed)
  const codeChanged =
    mapping.codeHash !== "" && currentCodeHash !== "" && currentCodeHash !== mapping.codeHash;

  if (figmaChanged && codeChanged) return "conflict";
  if (figmaChanged) return "figma_changed";
  if (codeChanged) return "code_changed";
  return "synced";
}

export default function MainView({ config, onLinkNew, onSettings }: MainViewProps) {
  const [mappings, setMappings] = useState<MappingWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const { mappings: rawMappings } = await requestToPlugin("GET_MAPPINGS");

      const paths = rawMappings.map((m) => m.linkedFile);
      const shas = await getFileShas(
        config.repoOwner,
        config.repoName,
        paths,
        config.branch
      );

      // Store initial codeHash for mappings that don't have one yet
      for (const m of rawMappings) {
        const sha = shas.get(m.linkedFile) ?? "";
        if (m.codeHash === "" && sha !== "") {
          m.codeHash = sha;
          requestToPlugin("UPDATE_CODE_HASH", { nodeId: m.nodeId, codeHash: sha });
        }
      }

      const withState: MappingWithState[] = rawMappings.map((m) => ({
        ...m,
        state: computeState(m, shas.get(m.linkedFile) ?? ""),
      }));

      setMappings(withState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleUnlink(nodeId: string) {
    await requestToPlugin("UNLINK_COMPONENT", { nodeId });
    refresh();
  }

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

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>
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
              onUnlink={() => handleUnlink(m.nodeId)}
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
