import { useState, useEffect } from "react";
import type { GlobalConfig } from "../shared/types";
import { onPluginEvent, requestToPlugin } from "./lib/messenger";
import { setToken, getToken, requestStoredToken, onTokenLoaded } from "./lib/storage";
import MainView from "./pages/MainView";
import LinkView from "./pages/LinkView";
import SettingsView from "./pages/SettingsView";

type Page = "main" | "link" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("settings");
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);

  useEffect(() => {
    // Restore persisted config from plugin data
    requestToPlugin("GET_CONFIG").then(({ config: savedConfig }) => {
      if (savedConfig) {
        setConfig(savedConfig);
      }
    });

    // Listen for token loaded from clientStorage
    onTokenLoaded((token) => {
      if (token) {
        // If we also have config, go to main view
        // (config state may not be set yet, so we check in render)
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
    // Persist config to plugin data
    requestToPlugin("SET_CONFIG", { config: newConfig });
    setPage("main");
  }

  async function handleLink(nodeId: string, codePath: string, componentName: string) {
    await requestToPlugin("LINK_COMPONENT", { nodeId, codePath, componentName });
    setPage("main");
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

  return (
    <MainView
      config={config}
      onLinkNew={() => setPage("link")}
      onSettings={() => setPage("settings")}
    />
  );
}
