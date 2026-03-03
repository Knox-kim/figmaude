import { useState } from "react";
import { requestToPlugin } from "../lib/messenger";
import { listAllFiles } from "../lib/github";

interface LinkViewProps {
  basePath: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  onDone: (linkedCount: number) => void;
  onCancel: () => void;
}

export default function LinkView({
  basePath,
  repoOwner,
  repoName,
  branch,
  onDone,
  onCancel,
}: LinkViewProps) {
  const [directory, setDirectory] = useState(basePath);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ linked: number; scanned: number } | null>(null);

  async function handleScan() {
    if (!directory.trim()) {
      setError("Directory path is required");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const [{ components: unlinked }, fileIndex] = await Promise.all([
        requestToPlugin("SCAN_COMPONENTS"),
        listAllFiles(repoOwner, repoName, branch, directory.trim()),
      ]);

      let linked = 0;
      for (const comp of unlinked) {
        const nameParts = comp.name.split("/");
        const leafName = nameParts[nameParts.length - 1].toLowerCase();
        const matchPath = fileIndex.get(leafName);
        if (matchPath) {
          const { success } = await requestToPlugin("LINK_COMPONENT", {
            nodeId: comp.nodeId,
            codePath: matchPath,
          });
          if (success) linked++;
        }
      }

      setResult({ linked, scanned: unlinked.length });

      if (linked > 0) {
        // Brief delay so user can see the result before navigating
        setTimeout(() => onDone(linked), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-base font-semibold mb-2">Auto-Link Components</h2>
      <p className="text-xs text-gray-500 mb-4">
        Scans unlinked Figma components and matches them to code files by name.
      </p>

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>
      )}

      {result && (
        <div
          className={`mb-3 rounded p-2 text-xs ${
            result.linked > 0
              ? "bg-green-50 text-green-700"
              : "bg-yellow-50 text-yellow-700"
          }`}
        >
          {result.linked > 0
            ? `${result.linked} of ${result.scanned} unlinked component${result.scanned > 1 ? "s" : ""} matched and linked.`
            : `No matches found among ${result.scanned} unlinked component${result.scanned > 1 ? "s" : ""}.`}
        </div>
      )}

      <label className="block mb-4">
        <span className="block text-xs font-medium text-gray-700 mb-1">
          Component Directory
        </span>
        <input
          type="text"
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
          placeholder="src/components"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
        />
        <span className="block text-xs text-gray-400 mt-1">
          Files under this path with matching names will be linked automatically.
        </span>
      </label>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleScan}
          disabled={loading}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Scanning..." : "Scan & Link"}
        </button>
      </div>
    </div>
  );
}
