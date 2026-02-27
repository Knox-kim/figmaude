let cachedToken: string | null = null;
let tokenLoadedCallback: ((token: string | null) => void) | null = null;

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

export function onTokenLoaded(callback: (token: string | null) => void): void {
  tokenLoadedCallback = callback;
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

// Listen for storage responses independently
window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg || msg.kind !== "storage-response") return;

  if (msg.key === "github-token") {
    cachedToken = msg.value ?? null;
    if (tokenLoadedCallback) {
      tokenLoadedCallback(cachedToken);
    }
  }
});
