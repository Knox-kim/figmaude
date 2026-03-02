import { useState, useEffect, useCallback } from "react";
import type { MappingEntry, SyncState, GlobalConfig, FlatSnapshot, TokenSnapshot } from "../../shared/types";
import { requestToPlugin } from "../lib/messenger";
import { getFileShas, listAllFiles } from "../lib/github";

export interface MappingWithState extends MappingEntry {
  state: SyncState;
  currentCodeHash: string;
  currentSnapshot?: FlatSnapshot;
  tokenSnapshot?: TokenSnapshot;
}

function computeState(
  mapping: MappingEntry,
  currentCodeHash: string,
  fetchFailed: boolean
): SyncState {
  // If GitHub API failed but we had a stored hash, treat as code_changed
  // so user knows something is off (rather than falsely showing "synced")
  if (fetchFailed && mapping.codeHash !== "") return "code_changed";

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
  const [autoLinkedCount, setAutoLinkedCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAutoLinkedCount(0);
    try {
      let { mappings: rawMappings, currentSnapshots } = await requestToPlugin("GET_MAPPINGS");

      // --- Auto-match: link unlinked Figma components to matching code files ---
      const [{ components: unlinked }, fileIndex] = await Promise.all([
        requestToPlugin("SCAN_COMPONENTS"),
        listAllFiles(config.repoOwner, config.repoName, config.branch, config.basePath),
      ]);

      let linked = 0;
      for (const comp of unlinked) {
        // Normalize: strip path separators, take last segment, lowercase
        const nameParts = comp.name.split("/");
        const leafName = nameParts[nameParts.length - 1].toLowerCase();
        const matchPath = fileIndex.get(leafName);
        if (matchPath) {
          await requestToPlugin("LINK_COMPONENT", { nodeId: comp.nodeId, codePath: matchPath });
          linked++;
        }
      }

      // Re-fetch mappings if any were auto-linked
      if (linked > 0) {
        const fresh = await requestToPlugin("GET_MAPPINGS");
        rawMappings = fresh.mappings;
        currentSnapshots = fresh.currentSnapshots;
        setAutoLinkedCount(linked);
      }

      // --- Fetch code hashes for all mapped files ---
      const paths = rawMappings.map((m) => m.linkedFile);
      const { shas, errors } = await getFileShas(config.repoOwner, config.repoName, paths, config.branch);

      if (errors.size > 0) {
        const msgs = [...errors.entries()].map(([p, e]) => `${p}: ${e}`);
        setError(`GitHub API errors: ${msgs.join(", ")}`);
      }

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
        currentSnapshot: currentSnapshots[m.nodeId],
        state: computeState(
          m,
          shas.get(m.linkedFile) ?? "",
          errors.has(m.linkedFile)
        ),
      }));

      // --- Token mappings (Variables & Styles) ---
      const tokenFile = config.tokenFile || "src/styles/tokens.css";
      {
        const [varsResult, stylesResult] = await Promise.all([
          requestToPlugin("GET_VARIABLES_MAPPING"),
          requestToPlugin("GET_STYLES_MAPPING"),
        ]);

        // Token file SHA (shared by both)
        let tokenSha = "";
        let tokenFetchFailed = false;
        try {
          const { shas: tokenShas, errors: tokenErrors } = await getFileShas(
            config.repoOwner, config.repoName, [tokenFile], config.branch
          );
          tokenSha = tokenShas.get(tokenFile) ?? "";
          tokenFetchFailed = tokenErrors.has(tokenFile);
        } catch {
          tokenFetchFailed = true;
        }

        // Auto-link if not yet linked
        if (!varsResult.mapping) {
          await requestToPlugin("LINK_VARIABLES", { tokenFile });
          const fresh = await requestToPlugin("GET_VARIABLES_MAPPING");
          varsResult.mapping = fresh.mapping;
          varsResult.currentSnapshot = fresh.currentSnapshot;
        }
        if (!stylesResult.mapping) {
          await requestToPlugin("LINK_STYLES", { tokenFile });
          const fresh = await requestToPlugin("GET_STYLES_MAPPING");
          stylesResult.mapping = fresh.mapping;
          stylesResult.currentSnapshot = fresh.currentSnapshot;
        }

        // Initialize code hash on first run
        if (varsResult.mapping && varsResult.mapping.codeHash === "" && tokenSha) {
          varsResult.mapping.codeHash = tokenSha;
          requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: tokenSha });
        }
        if (stylesResult.mapping && stylesResult.mapping.codeHash === "" && tokenSha) {
          stylesResult.mapping.codeHash = tokenSha;
          requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: tokenSha });
        }

        if (varsResult.mapping) {
          withState.push({
            ...varsResult.mapping,
            currentCodeHash: tokenSha,
            currentSnapshot: undefined,
            tokenSnapshot: varsResult.currentSnapshot ?? undefined,
            state: computeState(varsResult.mapping, tokenSha, tokenFetchFailed),
          });
        }

        if (stylesResult.mapping) {
          withState.push({
            ...stylesResult.mapping,
            currentCodeHash: tokenSha,
            currentSnapshot: undefined,
            tokenSnapshot: stylesResult.currentSnapshot ?? undefined,
            state: computeState(stylesResult.mapping, tokenSha, tokenFetchFailed),
          });
        }
      }

      setMappings(withState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }, [config.repoOwner, config.repoName, config.branch, config.basePath, config.tokenFile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { mappings, loading, error, autoLinkedCount, refresh };
}
