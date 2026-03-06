import { useState, useEffect, useCallback } from "react";
import type { MappingEntry, SyncState, GlobalConfig, FlatSnapshot, TokenSnapshot } from "../../shared/types";
import { requestToPlugin } from "../lib/messenger";
import { getFileShas, listAllFiles } from "../lib/github";

export interface MappingWithState extends MappingEntry {
  state: SyncState;
  currentCodeHash: string;
  currentSnapshot?: FlatSnapshot;
  tokenSnapshot?: TokenSnapshot;
  lastSyncedTokenSnapshot?: TokenSnapshot;
}

function computeState(
  mapping: MappingEntry,
  currentCodeHash: string,
  fetchFailed: boolean
): SyncState {
  // Never synced before — user must choose which side is the source of truth
  if (mapping.lastSyncedHash === "" && mapping.lastSyncedAt === "") return "newly_linked";

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
      const [{ components: unlinked }, { fileIndex, descriptorNames }] = await Promise.all([
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
          try {
            await requestToPlugin("LINK_COMPONENT", { nodeId: comp.nodeId, codePath: matchPath });
            linked++;
          } catch {
            // Skip failed auto-link, continue with remaining
          }
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
      // Change detection uses the CODE file (linkedFile), not the JSON descriptor.
      // The JSON is only the transport format for sync operations.
      const paths = rawMappings.map((m) => m.linkedFile);
      const { shas, errors } = await getFileShas(config.repoOwner, config.repoName, paths, config.branch);

      // Auto-unlink mappings whose code file was deleted/renamed (404 only)
      // Do NOT unlink on transient errors (rate limit, network, auth)
      const deletedPaths = new Set<string>();
      for (const [path, errMsg] of errors.entries()) {
        if (shas.get(path) === "" && errMsg.includes("404")) {
          deletedPaths.add(path);
        }
      }
      if (deletedPaths.size > 0) {
        for (const m of rawMappings) {
          if (deletedPaths.has(m.linkedFile)) {
            try {
              await requestToPlugin("UNLINK_COMPONENT", { nodeId: m.nodeId });
            } catch {
              // Skip failed unlink, continue with remaining
            }
          }
        }
        rawMappings = rawMappings.filter((m) => !deletedPaths.has(m.linkedFile));

        // Report remaining (non-deletion) errors only
        const remainingErrors = [...errors.entries()].filter(([p]) => !deletedPaths.has(p));
        if (remainingErrors.length > 0) {
          const msgs = remainingErrors.map(([p, e]) => `${p}: ${e}`);
          setError(`GitHub API errors: ${msgs.join(", ")}`);
        }
      } else if (errors.size > 0) {
        const msgs = [...errors.entries()].map(([p, e]) => `${p}: ${e}`);
        setError(`GitHub API errors: ${msgs.join(", ")}`);
      }

      for (const m of rawMappings) {
        const sha = shas.get(m.linkedFile) ?? "";
        if (m.codeHash === "" && sha !== "") {
          m.codeHash = sha;
          try {
            await requestToPlugin("UPDATE_CODE_HASH", { nodeId: m.nodeId, codeHash: sha });
          } catch {
            // Non-critical: hash will be updated on next refresh
          }
        }
      }

      const withState: MappingWithState[] = rawMappings.map((m) => {
        const sha = shas.get(m.linkedFile) ?? "";
        return {
          ...m,
          currentCodeHash: sha,
          currentSnapshot: currentSnapshots[m.nodeId],
          state: computeState(m, sha, errors.has(m.linkedFile)),
        };
      });

      // --- Collect unmatched components (code-only / figma-only) ---
      {
        // Names already linked (both auto-matched and previously linked)
        const linkedNames = new Set(
          rawMappings
            .filter((m) => m.kind === "component")
            .map((m) => m.componentName.toLowerCase())
        );

        // Figma-only: scanned components that have no matching code file
        for (const comp of unlinked) {
          const nameParts = comp.name.split("/");
          const leafName = nameParts[nameParts.length - 1].toLowerCase();
          if (!fileIndex.has(leafName) && !linkedNames.has(leafName)) {
            withState.push({
              kind: "component",
              nodeId: comp.nodeId,
              linkedFile: "",
              componentName: nameParts[nameParts.length - 1],
              figmaNodeName: comp.name,
              figmaHash: "",
              codeHash: "",
              lastSyncedHash: "",
              lastSyncedAt: "",
              lastSyncSource: "figma",
              state: "figma_only",
              currentCodeHash: "",
            });
          }
        }

        // Code-only: files that have a .figma/components/<Name>.json descriptor
        // but no matching Figma component (i.e. ready to be pulled into Figma)
        const allFigmaNames = new Set(
          unlinked.map((c) => {
            const parts = c.name.split("/");
            return parts[parts.length - 1].toLowerCase();
          })
        );
        // Collect code_only paths for additional SHA fetch
        const codeOnlyPaths: string[] = [];
        for (const [name, path] of fileIndex.entries()) {
          if (!linkedNames.has(name) && !allFigmaNames.has(name) && descriptorNames.has(name)) {
            codeOnlyPaths.push(path);
          }
        }

        // Fetch SHAs for code_only paths that weren't included in the main fetch
        let codeOnlyShas = shas;
        if (codeOnlyPaths.length > 0) {
          const missingPaths = codeOnlyPaths.filter((p) => !shas.has(p));
          if (missingPaths.length > 0) {
            const { shas: extraShas } = await getFileShas(
              config.repoOwner, config.repoName, missingPaths, config.branch
            );
            codeOnlyShas = new Map([...shas, ...extraShas]);
          }
        }

        for (const path of codeOnlyPaths) {
          const name = (path.split("/").pop() ?? "").replace(/\.\w+$/, "").toLowerCase();
          const fileName = path.split("/").pop() || name;
          const displayName = fileName.replace(/\.[^.]+$/, "");
          withState.push({
            kind: "component",
            nodeId: "",
            linkedFile: path,
            componentName: displayName,
            figmaNodeName: "",
            figmaHash: "",
            codeHash: "",
            lastSyncedHash: "",
            lastSyncedAt: "",
            lastSyncSource: "code",
            state: "code_only",
            currentCodeHash: codeOnlyShas.get(path) ?? "",
          });
        }
      }

      // --- Token mappings (Variables & Styles) ---
      const tokenFile = config.tokenFile || "src/tokens.css";
      {
        const [varsResult, stylesResult] = await Promise.all([
          requestToPlugin("GET_VARIABLES_MAPPING"),
          requestToPlugin("GET_STYLES_MAPPING"),
        ]);

        // Auto-link if not yet linked, or re-link if token file path changed
        if (!varsResult.mapping || varsResult.mapping.linkedFile !== tokenFile) {
          if (varsResult.mapping) await requestToPlugin("UNLINK_VARIABLES");
          await requestToPlugin("LINK_VARIABLES", { tokenFile });
          const fresh = await requestToPlugin("GET_VARIABLES_MAPPING");
          varsResult.mapping = fresh.mapping;
          varsResult.currentSnapshot = fresh.currentSnapshot;
        }
        if (!stylesResult.mapping || stylesResult.mapping.linkedFile !== tokenFile) {
          if (stylesResult.mapping) await requestToPlugin("UNLINK_STYLES");
          await requestToPlugin("LINK_STYLES", { tokenFile });
          const fresh = await requestToPlugin("GET_STYLES_MAPPING");
          stylesResult.mapping = fresh.mapping;
          stylesResult.currentSnapshot = fresh.currentSnapshot;
        }

        // Use mapping's linkedFile for SHA fetch — Push/Pull use this path,
        // so state computation must use the same path to stay consistent.
        const actualTokenFile = varsResult.mapping?.linkedFile
          || stylesResult.mapping?.linkedFile
          || tokenFile;

        // Token file SHA (shared by both)
        let tokenSha = "";
        let tokenFetchFailed = false;
        try {
          const { shas: tokenShas, errors: tokenErrors } = await getFileShas(
            config.repoOwner, config.repoName, [actualTokenFile], config.branch
          );
          tokenSha = tokenShas.get(actualTokenFile) ?? "";
          tokenFetchFailed = tokenErrors.has(actualTokenFile);
        } catch {
          tokenFetchFailed = true;
        }

        // Initialize code hash on first run
        if (varsResult.mapping && varsResult.mapping.codeHash === "" && tokenSha) {
          varsResult.mapping.codeHash = tokenSha;
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: tokenSha });
        }
        if (stylesResult.mapping && stylesResult.mapping.codeHash === "" && tokenSha) {
          stylesResult.mapping.codeHash = tokenSha;
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: tokenSha });
        }

        if (stylesResult.mapping) {
          withState.unshift({
            ...stylesResult.mapping,
            currentCodeHash: tokenSha,
            currentSnapshot: undefined,
            lastSyncedTokenSnapshot: stylesResult.mapping.tokenSnapshot,
            tokenSnapshot: stylesResult.currentSnapshot ?? undefined,
            state: computeState(stylesResult.mapping, tokenSha, tokenFetchFailed),
          });
        }

        if (varsResult.mapping) {
          withState.unshift({
            ...varsResult.mapping,
            currentCodeHash: tokenSha,
            currentSnapshot: undefined,
            lastSyncedTokenSnapshot: varsResult.mapping.tokenSnapshot,
            tokenSnapshot: varsResult.currentSnapshot ?? undefined,
            state: computeState(varsResult.mapping, tokenSha, tokenFetchFailed),
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
