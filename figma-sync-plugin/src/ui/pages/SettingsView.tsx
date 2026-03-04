import { useState } from "react";
import type { GlobalConfig } from "../../shared/types";

interface SettingsViewProps {
  config: GlobalConfig | null;
  token: string | null;
  onSave: (config: GlobalConfig, token: string) => void;
  onBack?: () => void;
}

export default function SettingsView({ config, token, onSave, onBack }: SettingsViewProps) {
  const [repoUrl, setRepoUrl] = useState(
    config ? `https://github.com/${config.repoOwner}/${config.repoName}` : ""
  );
  const [branch, setBranch] = useState(config?.branch ?? "main");
  const [basePath, setBasePath] = useState(config?.basePath ?? "src/components");
  const [framework, setFramework] = useState<GlobalConfig["framework"]>(
    config?.framework ?? "react"
  );
  const [styling, setStyling] = useState<GlobalConfig["styling"]>(
    config?.styling ?? "tailwind"
  );
  const [tokenFile, setTokenFile] = useState(config?.tokenFile ?? "src/tokens.css");
  const [componentPage, setComponentPage] = useState(config?.componentPage ?? "");
  const [tokenInput, setTokenInput] = useState(token ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      setError("Invalid GitHub repository URL");
      return;
    }

    const newConfig: GlobalConfig = {
      repoOwner: match[1],
      repoName: match[2].replace(/\.git$/, ""),
      branch,
      basePath,
      framework,
      styling,
      tokenFile,
      ...(componentPage.trim() ? { componentPage: componentPage.trim() } : {}),
    };

    if (!tokenInput.trim()) {
      setError("GitHub token is required");
      return;
    }

    setError(null);
    onSave(newConfig, tokenInput.trim());
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">Settings</h2>
        {onBack && (
          <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">
            Back
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>
      )}

      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">GitHub Repository</span>
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/user/project"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">Branch</span>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">Base Path</span>
        <input
          type="text"
          value={basePath}
          onChange={(e) => setBasePath(e.target.value)}
          placeholder="src/components"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">Token File</span>
        <input
          type="text"
          value={tokenFile}
          onChange={(e) => setTokenFile(e.target.value)}
          placeholder="src/tokens.css"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="block text-xs text-gray-400 mt-1">CSS file for design tokens (variables & styles)</span>
      </label>

      <div className="flex gap-3 mb-3">
        <label className="flex-1">
          <span className="block text-xs font-medium text-gray-700 mb-1">Framework</span>
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value as GlobalConfig["framework"])}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="react">React</option>
            <option value="vue">Vue</option>
          </select>
        </label>

        <label className="flex-1">
          <span className="block text-xs font-medium text-gray-700 mb-1">Styling</span>
          <select
            value={styling}
            onChange={(e) => setStyling(e.target.value as GlobalConfig["styling"])}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="tailwind">Tailwind</option>
            <option value="css-modules">CSS Modules</option>
          </select>
        </label>
      </div>

      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">Component Page</span>
        <input
          type="text"
          value={componentPage}
          onChange={(e) => setComponentPage(e.target.value)}
          placeholder="e.g. Components"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="block text-xs text-gray-400 mt-1">Figma page to scan for components (blank = current page)</span>
      </label>

      <label className="block mb-4">
        <span className="block text-xs font-medium text-gray-700 mb-1">GitHub Token</span>
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="ghp_xxxx..."
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="block text-xs text-gray-400 mt-1">Stored locally on this device only</span>
      </label>

      <button
        onClick={handleSave}
        className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Save
      </button>
    </div>
  );
}
