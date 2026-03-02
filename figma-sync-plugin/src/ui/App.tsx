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
