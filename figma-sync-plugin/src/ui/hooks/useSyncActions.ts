import { useState, useCallback } from "react";
import { requestToPlugin } from "../lib/messenger";
import type { MappingWithState } from "./useSync";

export function useSyncActions(refresh: () => Promise<void>) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUnlink = useCallback(async (nodeId: string) => {
    await requestToPlugin("UNLINK_COMPONENT", { nodeId });
    refresh();
  }, [refresh]);

  const handleMarkSynced = useCallback(async (mapping: MappingWithState) => {
    setSyncingId(mapping.nodeId);
    try {
      await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: mapping.nodeId });
      if (mapping.currentCodeHash) {
        await requestToPlugin("UPDATE_CODE_HASH", {
          nodeId: mapping.nodeId,
          codeHash: mapping.currentCodeHash,
        });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as synced");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  const handleForceSyncFigma = useCallback(async (mapping: MappingWithState) => {
    setSyncingId(mapping.nodeId);
    try {
      await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: mapping.nodeId });
      if (mapping.currentCodeHash) {
        await requestToPlugin("UPDATE_CODE_HASH", {
          nodeId: mapping.nodeId,
          codeHash: mapping.currentCodeHash,
        });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  const handleForceSyncCode = useCallback(async (mapping: MappingWithState) => {
    setSyncingId(mapping.nodeId);
    try {
      await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: mapping.nodeId });
      if (mapping.currentCodeHash) {
        await requestToPlugin("UPDATE_CODE_HASH", {
          nodeId: mapping.nodeId,
          codeHash: mapping.currentCodeHash,
        });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  return {
    syncingId,
    actionError: error,
    handleUnlink,
    handleMarkSynced,
    handleForceSyncFigma,
    handleForceSyncCode,
  };
}
