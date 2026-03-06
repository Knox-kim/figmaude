import { getToken } from "./storage";

const API_BASE = "https://api.github.com";

async function githubFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("GitHub token not configured");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

interface GitHubFileResponse {
  sha: string;
  name: string;
  path: string;
  content: string;
  encoding: string;
}

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function getFileSha(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string> {
  const encodedPath = encodePathSegments(path);
  const data = await githubFetch<GitHubFileResponse>(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
  );
  return data.sha;
}

export async function getFileShas(
  owner: string,
  repo: string,
  paths: string[],
  branch: string
): Promise<{ shas: Map<string, string>; errors: Map<string, string> }> {
  const shas = new Map<string, string>();
  const errors = new Map<string, string>();
  const promises = paths.map(async (path) => {
    try {
      const sha = await getFileSha(owner, repo, path, branch);
      shas.set(path, sha);
    } catch (err) {
      shas.set(path, "");
      errors.set(path, err instanceof Error ? err.message : "Unknown error");
    }
  });
  await Promise.all(promises);
  return { shas, errors };
}

interface GitHubRepoResponse {
  full_name: string;
  default_branch: string;
}

export interface GitHubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
}

export async function listDirectory(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<GitHubContentEntry[]> {
  const encodedPath = path ? encodePathSegments(path) : "";
  const endpoint = encodedPath
    ? `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
    : `/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`;
  const data = await githubFetch<GitHubContentEntry[]>(endpoint);
  return data.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
}

interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

const COMPONENT_EXTENSIONS = new Set([".tsx", ".vue", ".jsx", ".svelte"]);

/**
 * List all component files under basePath using the Git Trees API.
 * Returns a Map<lowercased_filename_without_ext, full_path>.
 * Files with ambiguous names (same name in multiple dirs) are excluded.
 */
export async function listAllFiles(
  owner: string,
  repo: string,
  branch: string,
  basePath: string
): Promise<{ fileIndex: Map<string, string>; descriptorNames: Set<string> }> {
  const normalizedBase = basePath.replace(/\/+$/, ""); // strip trailing slashes
  const data = await githubFetch<GitHubTreeResponse>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );

  const seen = new Map<string, string>();     // lowered name → full path
  const ambiguous = new Set<string>();         // names that appear in multiple dirs
  const descriptorNames = new Set<string>();   // component names with .figma/components/<Name>.json

  for (const entry of data.tree) {
    if (entry.type !== "blob") continue;

    // Collect .figma/components/*.json descriptor names
    if (entry.path.startsWith(".figma/components/") && entry.path.endsWith(".json")) {
      const jsonName = entry.path.split("/").pop()!.replace(/\.json$/, "").toLowerCase();
      descriptorNames.add(jsonName);
      // When basePath targets .figma/components, also index for auto-linking
      if (entry.path.startsWith(normalizedBase + "/")) {
        if (!ambiguous.has(jsonName)) {
          if (seen.has(jsonName)) {
            ambiguous.add(jsonName);
            seen.delete(jsonName);
          } else {
            seen.set(jsonName, entry.path);
          }
        }
      }
      continue;
    }

    if (normalizedBase && !entry.path.startsWith(normalizedBase + "/") && entry.path !== normalizedBase) continue;

    const ext = entry.path.substring(entry.path.lastIndexOf("."));
    if (!COMPONENT_EXTENSIONS.has(ext)) continue;

    const filename = entry.path.split("/").pop() ?? "";
    const nameKey = filename.replace(/\.\w+$/, "").toLowerCase();

    if (ambiguous.has(nameKey)) continue;
    if (seen.has(nameKey)) {
      // Duplicate — mark ambiguous and remove
      ambiguous.add(nameKey);
      seen.delete(nameKey);
    } else {
      seen.set(nameKey, entry.path);
    }
  }

  return { fileIndex: seen, descriptorNames };
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ content: string; sha: string }> {
  const encodedPath = encodePathSegments(path);
  const data = await githubFetch<GitHubFileResponse>(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
  );
  const binary = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const content = new TextDecoder().decode(bytes);
  return { content, sha: data.sha };
}

export async function updateFile(params: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  content: string;
  message: string;
  sha?: string;
}): Promise<{ sha: string }> {
  const { owner, repo, path, branch, content, message, sha } = params;
  const encodedPath = encodePathSegments(path);
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const body: Record<string, string> = {
    message,
    content: base64,
    branch,
  };
  if (sha) body.sha = sha;

  const data = await githubFetch<{ content: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return { sha: data.content.sha };
}

export async function verifyRepo(
  owner: string,
  repo: string
): Promise<{ valid: boolean; defaultBranch: string }> {
  try {
    const data = await githubFetch<GitHubRepoResponse>(
      `/repos/${owner}/${repo}`
    );
    return { valid: true, defaultBranch: data.default_branch };
  } catch {
    return { valid: false, defaultBranch: "main" };
  }
}
