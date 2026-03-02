import { useState } from "react";
import RepoExplorer from "../components/RepoExplorer";

interface LinkViewProps {
  selectedNodeId: string | null;
  selectedNodeName: string | null;
  basePath: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  onLink: (nodeId: string, codePath: string, componentName: string) => Promise<void>;
  onCancel: () => void;
}

export default function LinkView({
  selectedNodeId,
  selectedNodeName,
  basePath,
  repoOwner,
  repoName,
  branch,
  onLink,
  onCancel,
}: LinkViewProps) {
  const suggestedName = selectedNodeName ?? "";
  const [componentName, setComponentName] = useState(suggestedName);
  const [filePath, setFilePath] = useState(
    suggestedName ? `${basePath}/${suggestedName}.tsx` : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showExplorer, setShowExplorer] = useState(false);

  async function handleLink() {
    if (!selectedNodeId) {
      setError("Select a component in Figma first");
      return;
    }
    if (!filePath.trim()) {
      setError("File path is required");
      return;
    }
    if (!componentName.trim()) {
      setError("Component name is required");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onLink(selectedNodeId, filePath.trim(), componentName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link component");
      setLoading(false);
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-base font-semibold mb-4">Link Component</h2>

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>
      )}

      <div className="mb-3 rounded bg-gray-50 p-2">
        <span className="block text-xs text-gray-500">Figma Component</span>
        <span className="text-sm font-medium">
          {selectedNodeName ?? "No component selected"}
        </span>
        {selectedNodeId && (
          <span className="block text-xs text-gray-400 font-mono">{selectedNodeId}</span>
        )}
      </div>

      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">Component Name</span>
        <input
          type="text"
          value={componentName}
          onChange={(e) => setComponentName(e.target.value)}
          placeholder="compCard"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block mb-1">
        <span className="block text-xs font-medium text-gray-700 mb-1">Code File Path</span>
        <input
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="src/components/compCard.tsx"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
        />
      </label>

      <button
        type="button"
        onClick={() => setShowExplorer(!showExplorer)}
        className="text-xs text-blue-600 hover:text-blue-800 mb-1"
      >
        {showExplorer ? "Hide browser" : "Browse repo..."}
      </button>

      {showExplorer && (
        <RepoExplorer
          owner={repoOwner}
          repo={repoName}
          branch={branch}
          basePath={basePath}
          onSelect={(path) => {
            setFilePath(path);
            setShowExplorer(false);
          }}
          onClose={() => setShowExplorer(false)}
        />
      )}

      <div className="mb-4" />

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleLink}
          disabled={!selectedNodeId || loading}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Linking..." : "Link"}
        </button>
      </div>
    </div>
  );
}
