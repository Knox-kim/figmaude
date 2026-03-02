import { getToken } from "./storage";

const API_BASE = "https://api.github.com";

async function githubFetch<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("GitHub token not configured");

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
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
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const promises = paths.map(async (path) => {
    try {
      const sha = await getFileSha(owner, repo, path, branch);
      results.set(path, sha);
    } catch {
      results.set(path, "");
    }
  });
  await Promise.all(promises);
  return results;
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
