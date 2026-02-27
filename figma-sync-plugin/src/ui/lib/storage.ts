let cachedToken: string | null = null;

export function setToken(token: string): void {
  cachedToken = token;
  parent.postMessage(
    {
      pluginMessage: {
        kind: "storage",
        action: "set",
        key: "github-token",
        value: token,
      },
    },
    "*"
  );
}

export function getToken(): string | null {
  return cachedToken;
}

export function requestStoredToken(): void {
  parent.postMessage(
    {
      pluginMessage: {
        kind: "storage",
        action: "get",
        key: "github-token",
      },
    },
    "*"
  );
}

export function handleStorageMessage(msg: any): boolean {
  if (msg.kind === "storage-response") {
    if (msg.key === "github-token") {
      cachedToken = msg.value ?? null;
    }
    return true;
  }
  return false;
}
