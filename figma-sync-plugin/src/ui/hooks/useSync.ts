import { useState, useEffect, useCallback } from "react";
import type { MappingEntry, SyncState, GlobalConfig } from "../../shared/types";
import { requestToPlugin } from "../lib/messenger";
import { getFileShas } from "../lib/github";

export interface MappingWithState extends MappingEntry {
  state: SyncState;
  currentCodeHash: string;
}

function computeState(mapping: MappingEntry, currentCodeHash: string): SyncState {
  const figmaChanged = mapping.figmaHash !== mapping.lastSyncedHash;
  const codeChanged =
    mapping.codeHash !== "" && currentCodeHash !== "" && currentCodeHash !== mapping.codeHash;

  if (figmaChanged && codeChanged) return "conflict";
  if (figmaChanged) return "figma_changed";
  if (codeChanged) return "code_changed";
  return "synced";
}

export function useSync(config: GlobalConfig) {
  const [mappings, setMappings] = useState<MappingWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { mappings: rawMappings } = await requestToPlugin("GET_MAPPINGS");

      const paths = rawMappings.map((m) => m.linkedFile);
      const shas = await getFileShas(config.repoOwner, config.repoName, paths, config.branch);

      for (const m of rawMappings) {
        const sha = shas.get(m.linkedFile) ?? "";
        if (m.codeHash === "" && sha !== "") {
          m.codeHash = sha;
          requestToPlugin("UPDATE_CODE_HASH", { nodeId: m.nodeId, codeHash: sha });
        }
      }

      const withState: MappingWithState[] = rawMappings.map((m) => ({
        ...m,
        currentCodeHash: shas.get(m.linkedFile) ?? "",
        state: computeState(m, shas.get(m.linkedFile) ?? ""),
      }));

      setMappings(withState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }, [config.repoOwner, config.repoName, config.branch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { mappings, loading, error, refresh };
}
