import { useState, useEffect } from "react";
import { listDirectory, type GitHubContentEntry } from "../lib/github";

interface RepoExplorerProps {
  owner: string;
  repo: string;
  branch: string;
  basePath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function RepoExplorer({
  owner,
  repo,
  branch,
  basePath,
  onSelect,
  onClose,
}: RepoExplorerProps) {
  const [currentPath, setCurrentPath] = useState(basePath || "");
  const [entries, setEntries] = useState<GitHubContentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listDirectory(owner, repo, currentPath, branch)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load directory");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, currentPath]);

  const breadcrumbs = currentPath ? currentPath.split("/") : [];

  function handleBreadcrumb(index: number) {
    if (index < 0) {
      setCurrentPath("");
    } else {
      setCurrentPath(breadcrumbs.slice(0, index + 1).join("/"));
    }
  }

  function handleClick(entry: GitHubContentEntry) {
    if (entry.type === "dir") {
      setCurrentPath(entry.path);
    } else {
      onSelect(entry.path);
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg mt-2 mb-3 overflow-hidden">
      <div className="flex items-center justify-between bg-gray-50 px-2 py-1.5 border-b border-gray-200">
        <div className="flex items-center gap-1 text-xs text-gray-500 overflow-x-auto">
          <button
            onClick={() => handleBreadcrumb(-1)}
            className="hover:text-blue-600 shrink-0"
          >
            root
          </button>
          {breadcrumbs.map((segment, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <button
                onClick={() => handleBreadcrumb(i)}
                className="hover:text-blue-600"
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xs ml-2 shrink-0"
        >
          &times;
        </button>
      </div>

      {error && (
        <div className="px-2 py-1.5 text-xs text-red-600 bg-red-50">{error}</div>
      )}

      {loading ? (
        <div className="px-2 py-3 text-xs text-gray-400 text-center">Loading...</div>
      ) : (
        <div className="max-h-48 overflow-y-auto">
          {currentPath && (
            <button
              onClick={() => {
                const parent = currentPath.split("/").slice(0, -1).join("/");
                setCurrentPath(parent);
              }}
              className="w-full text-left px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 border-b border-gray-100"
            >
              ..
            </button>
          )}
          {entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => handleClick(entry)}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b border-gray-100 flex items-center gap-1.5"
            >
              <span className="text-gray-400 w-4 text-center shrink-0">
                {entry.type === "dir" ? "\u{1F4C1}" : "\u{1F4C4}"}
              </span>
              <span className={entry.type === "dir" ? "font-medium" : "font-mono"}>
                {entry.name}
              </span>
            </button>
          ))}
          {entries.length === 0 && !loading && (
            <div className="px-2 py-3 text-xs text-gray-400 text-center">
              Empty directory
            </div>
          )}
        </div>
      )}
    </div>
  );
}
