# Core Feature Completion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the Figma sync plugin's core features — extract hooks from MainView, add ConflictView page, verify build passes.

**Architecture:** Extract inline state/logic from MainView into two custom hooks (`useSync`, `useSyncActions`). Add a ConflictView page to App's router for dedicated conflict resolution UI. No new sandbox messages or API calls needed — everything uses existing infrastructure.

**Tech Stack:** React 19, TypeScript 5.7, Tailwind 4, Figma Plugin API, Vite + esbuild

---

### Task 1: Create `useSync` hook

Extract mapping loading + state computation from MainView into a reusable hook.

**Files:**
- Create: `src/ui/hooks/useSync.ts`
- Modify: `src/ui/pages/MainView.tsx`

**Step 1: Create the hook file**

Create `src/ui/hooks/useSync.ts`:

```typescript
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
```

**Step 2: Run typecheck**

Run: `cd figma-sync-plugin && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors from hook file)

---

### Task 2: Create `useSyncActions` hook

Extract sync action handlers from MainView.

**Files:**
- Create: `src/ui/hooks/useSyncActions.ts`

**Step 1: Create the hook file**

Create `src/ui/hooks/useSyncActions.ts`:

```typescript
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
```

**Step 2: Run typecheck**

Run: `cd figma-sync-plugin && npx tsc --noEmit -p tsconfig.json`
Expected: PASS

---

### Task 3: Refactor MainView to use hooks

Replace all inline logic in MainView with the two hooks.

**Files:**
- Modify: `src/ui/pages/MainView.tsx`

**Step 1: Rewrite MainView**

Replace entire `src/ui/pages/MainView.tsx` with:

```typescript
import type { GlobalConfig } from "../../shared/types";
import { useSync } from "../hooks/useSync";
import { useSyncActions } from "../hooks/useSyncActions";
import ComponentCard from "../components/ComponentCard";

interface MainViewProps {
  config: GlobalConfig;
  onLinkNew: () => void;
  onSettings: () => void;
  onConflict: (nodeId: string) => void;
}

export default function MainView({ config, onLinkNew, onSettings, onConflict }: MainViewProps) {
  const { mappings, loading, error, refresh } = useSync(config);
  const { syncingId, actionError, handleUnlink, handleMarkSynced, handleForceSyncFigma, handleForceSyncCode } = useSyncActions(refresh);

  const displayError = error || actionError;

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

      {displayError && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{displayError}</div>
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
              syncing={syncingId === m.nodeId}
              onUnlink={() => handleUnlink(m.nodeId)}
              onMarkSynced={() => handleMarkSynced(m)}
              onForceSyncFigma={() => handleForceSyncFigma(m)}
              onForceSyncCode={() => handleForceSyncCode(m)}
              onResolveConflict={() => onConflict(m.nodeId)}
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
```

Key changes:
- Imports `useSync` and `useSyncActions` instead of inline logic
- Removes `MappingWithState` interface, `computeState`, `useState/useEffect` imports
- Adds `onConflict` prop (for routing to ConflictView)
- Adds `onResolveConflict` prop to ComponentCard (for conflict items)

**Step 2: Run typecheck**

Run: `cd figma-sync-plugin && npx tsc --noEmit -p tsconfig.json`
Expected: FAIL — ComponentCard doesn't accept `onResolveConflict` yet. That's fixed in Task 4.

---

### Task 4: Update ComponentCard with conflict navigation

Add `onResolveConflict` prop and a "Resolve" button for conflict state.

**Files:**
- Modify: `src/ui/components/ComponentCard.tsx`

**Step 1: Update ComponentCard**

Replace entire `src/ui/components/ComponentCard.tsx` with:

```typescript
import type { SyncState } from "../../shared/types";
import StatusBadge from "./StatusBadge";

interface ComponentCardProps {
  componentName: string;
  codePath: string;
  state: SyncState;
  onUnlink: () => void;
  onMarkSynced: () => void;
  onForceSyncFigma: () => void;
  onForceSyncCode: () => void;
  onResolveConflict?: () => void;
  syncing: boolean;
}

export default function ComponentCard({
  componentName,
  codePath,
  state,
  onUnlink,
  onMarkSynced,
  onForceSyncFigma,
  onForceSyncCode,
  onResolveConflict,
  syncing,
}: ComponentCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{componentName}</span>
        <StatusBadge state={state} />
      </div>
      <div className="text-xs text-gray-500 mb-2 font-mono">{codePath}</div>
      <div className="flex items-center gap-2">
        {(state === "figma_changed" || state === "code_changed") && (
          <button
            onClick={onMarkSynced}
            disabled={syncing}
            className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Mark as Synced"}
          </button>
        )}
        {state === "conflict" && (
          <button
            onClick={onResolveConflict}
            className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Resolve
          </button>
        )}
        <button
          onClick={onUnlink}
          className="text-xs text-red-500 hover:text-red-700 ml-auto"
        >
          Unlink
        </button>
      </div>
    </div>
  );
}
```

Key changes:
- Added optional `onResolveConflict` prop
- Conflict state now shows single "Resolve" button instead of inline Keep Figma/Keep Code
- Keep Figma/Keep Code moved to ConflictView (Task 5)

**Step 2: Run typecheck**

Run: `cd figma-sync-plugin && npx tsc --noEmit -p tsconfig.json`
Expected: PASS

---

### Task 5: Create ConflictView page

Dedicated page for resolving conflicts with more context than the inline buttons.

**Files:**
- Create: `src/ui/pages/ConflictView.tsx`

**Step 1: Create ConflictView**

Create `src/ui/pages/ConflictView.tsx`:

```typescript
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
```

**Step 2: Run typecheck**

Run: `cd figma-sync-plugin && npx tsc --noEmit -p tsconfig.json`
Expected: PASS

---

### Task 6: Wire ConflictView into App router

Add `conflict` page to App's router and connect the data flow.

**Files:**
- Modify: `src/ui/App.tsx`

**Step 1: Update App.tsx**

The full updated `App.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { GlobalConfig } from "../shared/types";
import { onPluginEvent, requestToPlugin } from "./lib/messenger";
import { setToken, getToken, requestStoredToken, onTokenLoaded } from "./lib/storage";
import MainView from "./pages/MainView";
import LinkView from "./pages/LinkView";
import SettingsView from "./pages/SettingsView";
import ConflictView from "./pages/ConflictView";
import { useSync } from "./hooks/useSync";
import { useSyncActions } from "./hooks/useSyncActions";

type Page = "main" | "link" | "settings" | "conflict";

export default function App() {
  const [page, setPage] = useState<Page>("settings");
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [conflictNodeId, setConflictNodeId] = useState<string | null>(null);

  useEffect(() => {
    requestToPlugin("GET_CONFIG").then(({ config: savedConfig }) => {
      if (savedConfig) {
        setConfig(savedConfig);
      }
    });

    onTokenLoaded((token) => {
      if (token) {
        setPage((prev) => prev === "settings" ? "main" : prev);
      }
    });

    requestStoredToken();

    const unsubscribe = onPluginEvent((event) => {
      if (event.type === "SELECTION_CHANGED") {
        setSelectedNodeId(event.nodeId);
        setSelectedNodeName(event.nodeName);
      }
    });

    return unsubscribe;
  }, []);

  function handleSaveSettings(newConfig: GlobalConfig, token: string) {
    setConfig(newConfig);
    setToken(token);
    requestToPlugin("SET_CONFIG", { config: newConfig });
    setPage("main");
  }

  async function handleLink(nodeId: string, codePath: string, componentName: string) {
    const { success } = await requestToPlugin("LINK_COMPONENT", { nodeId, codePath, componentName });
    if (!success) {
      throw new Error("Failed to link: node may not be accessible on this page");
    }
    setPage("main");
  }

  function handleConflict(nodeId: string) {
    setConflictNodeId(nodeId);
    setPage("conflict");
  }

  if (page === "settings" || !config) {
    return (
      <SettingsView
        config={config}
        token={getToken()}
        onSave={handleSaveSettings}
        onBack={config ? () => setPage("main") : undefined}
      />
    );
  }

  if (page === "link") {
    return (
      <LinkView
        selectedNodeId={selectedNodeId}
        selectedNodeName={selectedNodeName}
        basePath={config.basePath}
        onLink={handleLink}
        onCancel={() => setPage("main")}
      />
    );
  }

  if (page === "conflict" && conflictNodeId) {
    return (
      <ConflictPage
        config={config}
        conflictNodeId={conflictNodeId}
        onBack={() => setPage("main")}
      />
    );
  }

  return (
    <MainView
      config={config}
      onLinkNew={() => setPage("link")}
      onSettings={() => setPage("settings")}
      onConflict={handleConflict}
    />
  );
}

// Separate component so hooks (useSync/useSyncActions) are called at top level
function ConflictPage({
  config,
  conflictNodeId,
  onBack,
}: {
  config: GlobalConfig;
  conflictNodeId: string;
  onBack: () => void;
}) {
  const { mappings, refresh } = useSync(config);
  const { syncingId, handleForceSyncFigma, handleForceSyncCode } = useSyncActions(refresh);

  const mapping = mappings.find((m) => m.nodeId === conflictNodeId);

  if (!mapping) {
    return (
      <div className="p-4">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm mb-4">
          &larr; Back
        </button>
        <div className="text-center text-sm text-gray-400 py-8">
          Mapping not found. It may have been unlinked.
        </div>
      </div>
    );
  }

  return (
    <ConflictView
      mapping={mapping}
      onKeepFigma={async () => {
        await handleForceSyncFigma(mapping);
        onBack();
      }}
      onKeepCode={async () => {
        await handleForceSyncCode(mapping);
        onBack();
      }}
      onBack={onBack}
      syncing={syncingId === conflictNodeId}
    />
  );
}
```

Key changes:
- Added `"conflict"` to `Page` type
- Added `conflictNodeId` state
- Added `ConflictPage` wrapper component for proper hook usage
- Wired `onConflict` callback from MainView

**Step 2: Run typecheck**

Run: `cd figma-sync-plugin && npx tsc --noEmit -p tsconfig.json`
Expected: PASS

---

### Task 7: Build verification

Verify the full plugin builds without errors.

**Files:** None (verification only)

**Step 1: Install dependencies**

Run: `cd figma-sync-plugin && npm install`
Expected: Clean install, no errors

**Step 2: Run typecheck for both sandbox and UI**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS for both sandbox and UI

**Step 3: Run full build**

Run: `cd figma-sync-plugin && npm run build`
Expected: Produces `dist/code.js` (sandbox) and `dist/index.html` (UI)

**Step 4: Verify dist files exist**

Run: `ls -la figma-sync-plugin/dist/`
Expected: Both `code.js` and `index.html` present

**Step 5: Commit all changes**

```bash
cd figma-sync-plugin
git add src/ui/hooks/useSync.ts src/ui/hooks/useSyncActions.ts src/ui/pages/ConflictView.tsx src/ui/pages/MainView.tsx src/ui/components/ComponentCard.tsx src/ui/App.tsx
git commit -m "feat: extract hooks, add ConflictView, complete core plugin features"
```
