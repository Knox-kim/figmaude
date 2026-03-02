import { useState, useCallback } from "react";
import { requestToPlugin } from "../lib/messenger";
import type { MappingWithState } from "./useSync";

export function useSyncActions(refresh: () => Promise<void>) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUnlink = useCallback(async (mapping: MappingWithState) => {
    if (mapping.kind === "variable") {
      await requestToPlugin("UNLINK_VARIABLES");
    } else if (mapping.kind === "style") {
      await requestToPlugin("UNLINK_STYLES");
    } else {
      await requestToPlugin("UNLINK_COMPONENT", { nodeId: mapping.nodeId });
    }
    refresh();
  }, [refresh]);

  const handleMarkSynced = useCallback(async (mapping: MappingWithState) => {
    setSyncingId(mapping.nodeId);
    try {
      if (mapping.kind === "variable") {
        await requestToPlugin("UPDATE_VARIABLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else if (mapping.kind === "style") {
        await requestToPlugin("UPDATE_STYLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else {
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: mapping.nodeId });
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_CODE_HASH", {
            nodeId: mapping.nodeId,
            codeHash: mapping.currentCodeHash,
          });
        }
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as synced");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  const handleForceSyncFigma = useCallback(async (mapping: MappingWithState) => {
    const id = mapping.nodeId;
    setSyncingId(id);
    try {
      if (mapping.kind === "variable") {
        await requestToPlugin("UPDATE_VARIABLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else if (mapping.kind === "style") {
        await requestToPlugin("UPDATE_STYLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else {
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: id });
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_CODE_HASH", { nodeId: id, codeHash: mapping.currentCodeHash });
        }
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  const handleForceSyncCode = useCallback(async (mapping: MappingWithState) => {
    const id = mapping.nodeId;
    setSyncingId(id);
    try {
      if (mapping.kind === "variable") {
        await requestToPlugin("UPDATE_VARIABLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else if (mapping.kind === "style") {
        await requestToPlugin("UPDATE_STYLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else {
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: id });
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_CODE_HASH", { nodeId: id, codeHash: mapping.currentCodeHash });
        }
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
