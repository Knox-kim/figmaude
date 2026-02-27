import { useState, useEffect } from "react";
import type { GlobalConfig } from "../shared/types";
import { onPluginEvent, requestToPlugin } from "./lib/messenger";
import { setToken, getToken, requestStoredToken, handleStorageMessage } from "./lib/storage";
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
    const originalOnMessage = window.onmessage;
    window.onmessage = (e: MessageEvent) => {
      const msg = e.data.pluginMessage;
      if (msg && handleStorageMessage(msg)) {
        if (getToken() && config) {
          setPage("main");
        }
        return;
      }
      if (originalOnMessage) {
        originalOnMessage.call(window, e);
      }
    };

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
