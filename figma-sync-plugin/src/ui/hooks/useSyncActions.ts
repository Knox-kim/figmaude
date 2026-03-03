import { useState, useCallback } from "react";
import { requestToPlugin } from "../lib/messenger";
import { getFileContent, updateFile } from "../lib/github";
import { parseCSSTokenFile } from "../lib/cssParser";
import type { MappingWithState } from "./useSync";
import type { GlobalConfig, ComponentDescriptor } from "../../shared/types";

export type ProgressMessage = { nodeId: string; message: string } | null;

export function useSyncActions(config: GlobalConfig, refresh: () => Promise<void>) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressMessage>(null);

  function reportProgress(nodeId: string, message: string) {
    setProgress({ nodeId, message });
  }

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

  // --- Push to Code (Figma → GitHub) ---

  const handleForceSyncFigma = useCallback(async (mapping: MappingWithState) => {
    const id = mapping.nodeId;
    setSyncingId(id);
    setError(null);

    try {
      if (mapping.kind === "variable" || mapping.kind === "style") {
        // Token push: generate CSS → commit to GitHub
        reportProgress(id, "Generating CSS from Figma tokens...");
        const { css } = await requestToPlugin("GENERATE_CSS");

        reportProgress(id, "Reading current file from GitHub...");
        let sha: string | undefined;
        try {
          const existing = await getFileContent(
            config.repoOwner, config.repoName, mapping.linkedFile, config.branch
          );
          sha = existing.sha;
        } catch {
          // File doesn't exist yet — will create
        }

        reportProgress(id, "Committing tokens to GitHub...");
        const result = await updateFile({
          owner: config.repoOwner,
          repo: config.repoName,
          path: mapping.linkedFile,
          branch: config.branch,
          content: css,
          message: `sync: update design tokens from Figma`,
          sha,
        });

        // Update both variable and style hashes since the CSS file contains all tokens
        await requestToPlugin("UPDATE_VARIABLES_HASH");
        await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: result.sha });
        await requestToPlugin("UPDATE_STYLES_HASH");
        await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: result.sha });
      } else {
        // Component push: extract JSON from Figma and commit to GitHub
        reportProgress(id, "Extracting component JSON...");
        const { json } = await requestToPlugin("EXTRACT_COMPONENT_JSON", { nodeId: id });

        reportProgress(id, "Committing to GitHub...");
        const jsonPath = `.figma/components/${mapping.componentName}.json`;
        const content = JSON.stringify(json, null, 2);

        let existingSha: string | undefined;
        try {
          const existing = await getFileContent(config.repoOwner, config.repoName, jsonPath, config.branch);
          existingSha = existing.sha;
        } catch {
          // File doesn't exist yet
        }

        await updateFile({
          owner: config.repoOwner,
          repo: config.repoName,
          path: jsonPath,
          branch: config.branch,
          content,
          message: `sync: update ${mapping.componentName} component descriptor`,
          sha: existingSha,
        });

        // Snapshot the code file's current SHA as the sync baseline
        // Change detection tracks the code file (linkedFile), not the JSON file
        reportProgress(id, "Updating hashes...");
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: id });
        await requestToPlugin("UPDATE_CODE_HASH", { nodeId: id, codeHash: mapping.currentCodeHash });
      }

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push to code");
    } finally {
      setSyncingId(null);
      setProgress(null);
    }
  }, [config, refresh]);

  // --- Pull from Code (GitHub → Figma) ---

  const handleForceSyncCode = useCallback(async (mapping: MappingWithState) => {
    const id = mapping.nodeId;
    setSyncingId(id);
    setError(null);

    try {
      if (mapping.kind === "variable" || mapping.kind === "style") {
        // Token pull: read CSS from GitHub and apply to Figma
        reportProgress(id, "Reading tokens from GitHub...");
        const { content: css, sha } = await getFileContent(
          config.repoOwner, config.repoName, mapping.linkedFile, config.branch
        );

        reportProgress(id, "Parsing CSS tokens...");
        const parsed = parseCSSTokenFile(css);

        if (mapping.kind === "variable") {
          reportProgress(id, "Applying variable values to Figma...");
          await requestToPlugin("APPLY_VARIABLE_VALUES", { values: parsed.variables });
          await requestToPlugin("UPDATE_VARIABLES_HASH");
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: sha });
        } else {
          reportProgress(id, "Applying style values to Figma...");
          const allStyles = [...parsed.paintStyles, ...parsed.textStyles, ...parsed.effectStyles];
          await requestToPlugin("APPLY_STYLE_VALUES", { values: allStyles });
          await requestToPlugin("UPDATE_STYLES_HASH");
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: sha });
        }
      } else {
        // Component pull: read JSON from GitHub and apply to Figma
        reportProgress(id, "Reading component JSON from GitHub...");
        const jsonPath = `.figma/components/${mapping.componentName}.json`;
        const { content } = await getFileContent(
          config.repoOwner, config.repoName, jsonPath, config.branch
        );

        const json: ComponentDescriptor = JSON.parse(content);

        reportProgress(id, "Applying to Figma...");
        const { nodeId: newNodeId } = await requestToPlugin("APPLY_COMPONENT_JSON", {
          nodeId: id,
          json,
        });

        // Snapshot the code file's current SHA as the sync baseline
        reportProgress(id, "Updating hashes...");
        if (newNodeId !== id) {
          await requestToPlugin("LINK_COMPONENT", { nodeId: newNodeId, codePath: mapping.linkedFile });
          await requestToPlugin("UNLINK_COMPONENT", { nodeId: id });
        }
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: newNodeId });
        await requestToPlugin("UPDATE_CODE_HASH", { nodeId: newNodeId, codeHash: mapping.currentCodeHash });
      }

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pull from code");
    } finally {
      setSyncingId(null);
      setProgress(null);
    }
  }, [config, refresh]);

  return {
    syncingId,
    actionError: error,
    progress,
    handleUnlink,
    handleMarkSynced,
    handleForceSyncFigma,
    handleForceSyncCode,
  };
}
