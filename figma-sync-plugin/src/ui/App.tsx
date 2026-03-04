import { useState, useEffect } from "react";
import type { GlobalConfig } from "../shared/types";
import { onPluginEvent, requestToPlugin } from "./lib/messenger";
import { setToken, getToken, requestStoredToken, onTokenLoaded } from "./lib/storage";
import MainView from "./pages/MainView";
import LinkView from "./pages/LinkView";
import SettingsView from "./pages/SettingsView";
import DetailsView from "./pages/DetailsView";
import { useSync } from "./hooks/useSync";
import { useSyncActions } from "./hooks/useSyncActions";

type Page = "main" | "link" | "settings" | "details";

export default function App() {
  const [page, setPage] = useState<Page>("settings");
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [detailsNodeId, setDetailsNodeId] = useState<string | null>(null);

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

    return onPluginEvent(() => {});
  }, []);

  function handleSaveSettings(newConfig: GlobalConfig, token: string) {
    setConfig(newConfig);
    setToken(token);
    requestToPlugin("SET_CONFIG", { config: newConfig });
    setPage("main");
  }

  function handleShowDetails(nodeId: string) {
    setDetailsNodeId(nodeId);
    setPage("details");
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
        basePath={config.basePath}
        repoOwner={config.repoOwner}
        repoName={config.repoName}
        branch={config.branch}
        onDone={() => setPage("main")}
        onCancel={() => setPage("main")}
      />
    );
  }

  if (page === "details" && detailsNodeId) {
    return (
      <DetailsPage
        config={config}
        detailsNodeId={detailsNodeId}
        onBack={() => setPage("main")}
      />
    );
  }

  return (
    <MainView
      config={config}
      onSettings={() => setPage("settings")}
      onShowDetails={handleShowDetails}
    />
  );
}

function DetailsPage({
  config,
  detailsNodeId,
  onBack,
}: {
  config: GlobalConfig;
  detailsNodeId: string;
  onBack: () => void;
}) {
  const { mappings, loading, refresh } = useSync(config);
  const { syncingId, handleForceSyncFigma, handleForceSyncCode } = useSyncActions(config, refresh);

  const mapping = mappings.find((m) => m.nodeId === detailsNodeId);

  if (loading || !mapping) {
    return (
      <div className="p-4">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm mb-4">
          &larr; Back
        </button>
        <div className="text-center text-sm text-gray-400 py-8">
          {loading ? "Loading..." : "Mapping not found. It may have been unlinked."}
        </div>
      </div>
    );
  }

  return (
    <DetailsView
      mapping={mapping}
      onPushToCode={async () => {
        await handleForceSyncFigma(mapping);
        onBack();
      }}
      onPullFromCode={async () => {
        await handleForceSyncCode(mapping);
        onBack();
      }}
      onBack={onBack}
      syncing={syncingId === detailsNodeId}
    />
  );
}
