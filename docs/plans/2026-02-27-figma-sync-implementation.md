# Figma Sync Plugin MVP — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Figma 컴포넌트와 코드 파일을 1:1 매핑하고 해시 기반으로 변경 상태를 추적하는 Figma 플러그인 MVP를 구현한다.

**Architecture:** Sandbox(데이터/로직) + UI iframe(프레젠테이션) 분리. Sandbox는 esbuild, UI는 Vite+singlefile로 빌드. 양쪽은 타입 안전한 postMessage 시스템으로 통신.

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4, Vite 6 + vite-plugin-singlefile, esbuild, Figma Plugin API, GitHub REST API

**Design Doc:** `docs/plans/2026-02-27-figma-sync-mvp-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `figma-sync-plugin/package.json`
- Create: `figma-sync-plugin/manifest.json`
- Create: `figma-sync-plugin/tsconfig.json`
- Create: `figma-sync-plugin/tsconfig.sandbox.json`
- Create: `figma-sync-plugin/vite.config.ts`
- Create: `figma-sync-plugin/esbuild.sandbox.mjs`
- Create: `figma-sync-plugin/src/ui/index.html`
- Create: `figma-sync-plugin/src/ui/index.css`
- Create: `figma-sync-plugin/src/ui/main.tsx`
- Create: `figma-sync-plugin/src/ui/App.tsx`
- Create: `figma-sync-plugin/src/sandbox/controller.ts`

**Step 1: Create directory structure and package.json**

```bash
mkdir -p figma-sync-plugin/src/{sandbox,ui/{pages,components,lib},shared}
cd figma-sync-plugin
```

```json
// package.json
{
  "name": "figma-sync-plugin",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "concurrently -n sandbox,ui \"npm:dev:sandbox\" \"npm:dev:ui\"",
    "dev:sandbox": "node esbuild.sandbox.mjs --watch",
    "dev:ui": "vite build --watch",
    "build": "npm run build:sandbox && npm run build:ui",
    "build:sandbox": "node esbuild.sandbox.mjs --minify",
    "build:ui": "vite build",
    "typecheck": "npm run typecheck:sandbox && npm run typecheck:ui",
    "typecheck:sandbox": "tsc --noEmit -p tsconfig.sandbox.json",
    "typecheck:ui": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@figma/plugin-typings": "^1.121.0",
    "@tailwindcss/vite": "^4.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^9.1.0",
    "esbuild": "^0.25.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.7.0",
    "vite": "^6.2.0",
    "vite-plugin-singlefile": "^2.3.0"
  }
}
```

**Step 2: Create manifest.json**

```json
{
  "name": "Figma Sync",
  "id": "000000000000000000",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/index.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["https://api.github.com"]
  }
}
```

**Step 3: Create tsconfig.json (UI)**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/ui/**/*", "src/shared/**/*"]
}
```

**Step 4: Create tsconfig.sandbox.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "typeRoots": [
      "./node_modules/@types",
      "./node_modules/@figma"
    ]
  },
  "include": ["src/sandbox/**/*", "src/shared/**/*"]
}
```

**Step 5: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";

export default defineConfig({
  root: "./src/ui",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    target: "esnext",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
```

**Step 6: Create esbuild.sandbox.mjs**

```javascript
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

const ctx = await esbuild.context({
  entryPoints: ["src/sandbox/controller.ts"],
  bundle: true,
  outfile: "dist/code.js",
  format: "esm",
  target: "es2022",
  minify,
  sourcemap: false,
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import"],
});

if (watch) {
  await ctx.watch();
  console.log("[esbuild] watching for sandbox changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

**Step 7: Create minimal UI files**

```html
<!-- src/ui/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Figma Sync</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

```css
/* src/ui/index.css */
@import "tailwindcss";
```

```tsx
// src/ui/main.tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
```

```tsx
// src/ui/App.tsx
export default function App() {
  return <div className="p-4 text-sm">Figma Sync Plugin</div>;
}
```

**Step 8: Create minimal sandbox file**

```typescript
// src/sandbox/controller.ts
figma.showUI(__html__, { width: 400, height: 600 });

figma.ui.onmessage = (msg: { type: string }) => {
  console.log("Received message:", msg.type);
};
```

**Step 9: Install dependencies and verify build**

```bash
cd figma-sync-plugin && npm install
npm run build
npm run typecheck
```

Expected: `dist/code.js` and `dist/index.html` 생성, typecheck 통과.

**Step 10: Commit**

```bash
git add .
git commit -m "feat: scaffold Figma Sync plugin project"
```

---

### Task 2: Shared Types

**Files:**
- Create: `figma-sync-plugin/src/shared/types.ts`
- Create: `figma-sync-plugin/src/shared/messages.ts`

**Step 1: Create shared types**

```typescript
// src/shared/types.ts

export interface MappingEntry {
  nodeId: string;
  linkedFile: string;
  componentName: string;
  figmaHash: string;
  codeHash: string;
  lastSyncedHash: string;
  lastSyncedAt: string;
  lastSyncSource: "figma" | "code";
}

export interface GlobalConfig {
  repoOwner: string;
  repoName: string;
  branch: string;
  basePath: string;
  framework: "react" | "vue";
  styling: "tailwind" | "css-modules";
}

export type SyncState =
  | "synced"
  | "figma_changed"
  | "code_changed"
  | "conflict"
  | "not_linked";

export interface SyncStatus {
  nodeId: string;
  componentName: string;
  codePath: string;
  state: SyncState;
  figmaHash: string;
  codeHash: string;
}
```

**Step 2: Create message types**

```typescript
// src/shared/messages.ts
import type { MappingEntry, SyncStatus } from "./types";

// --- UI → Sandbox requests ---

export type PluginRequest =
  | { type: "GET_MAPPINGS" }
  | { type: "LINK_COMPONENT"; nodeId: string; codePath: string; componentName: string }
  | { type: "UNLINK_COMPONENT"; nodeId: string }
  | { type: "UPDATE_FIGMA_HASH"; nodeId: string }
  | { type: "GET_SELECTED_NODE" };

export type PluginRequestType = PluginRequest["type"];

export interface ResponseMap {
  GET_MAPPINGS: { mappings: MappingEntry[] };
  LINK_COMPONENT: { success: boolean };
  UNLINK_COMPONENT: { success: boolean };
  UPDATE_FIGMA_HASH: { hash: string };
  GET_SELECTED_NODE: { nodeId: string | null; nodeName: string | null };
}

// --- Sandbox → UI events ---

export type PluginEvent =
  | { type: "MAPPINGS_LOADED"; mappings: MappingEntry[] }
  | { type: "STATUS_UPDATED"; statuses: SyncStatus[] }
  | { type: "SELECTION_CHANGED"; nodeId: string | null; nodeName: string | null }
  | { type: "ERROR"; message: string };

// --- Wire format (internal) ---

export interface RequestEnvelope {
  kind: "request";
  requestId: string;
  payload: PluginRequest;
}

export interface ResponseEnvelope {
  kind: "response";
  requestId: string;
  payload: ResponseMap[PluginRequestType] | { error: string };
}

export interface EventEnvelope {
  kind: "event";
  payload: PluginEvent;
}

export type SandboxMessage = ResponseEnvelope | EventEnvelope;
export type UIMessage = RequestEnvelope;
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: 통과.

**Step 4: Commit**

```bash
git add src/shared/
git commit -m "feat: add shared types and message definitions"
```

---

### Task 3: Messenger System

**Files:**
- Create: `figma-sync-plugin/src/ui/lib/messenger.ts`
- Create: `figma-sync-plugin/src/sandbox/messenger.ts`

**Step 1: Create UI-side messenger**

```typescript
// src/ui/lib/messenger.ts
import type {
  PluginRequest,
  PluginRequestType,
  ResponseMap,
  RequestEnvelope,
  ResponseEnvelope,
  EventEnvelope,
  PluginEvent,
} from "../../shared/messages";

type EventHandler = (event: PluginEvent) => void;

let requestCounter = 0;
const pendingRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (reason: any) => void }
>();
const eventHandlers = new Set<EventHandler>();

// Listen for messages from sandbox
window.onmessage = (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;

  if (msg.kind === "response") {
    const envelope = msg as ResponseEnvelope;
    const pending = pendingRequests.get(envelope.requestId);
    if (pending) {
      pendingRequests.delete(envelope.requestId);
      if ("error" in envelope.payload) {
        pending.reject(new Error(envelope.payload.error));
      } else {
        pending.resolve(envelope.payload);
      }
    }
  } else if (msg.kind === "event") {
    const envelope = msg as EventEnvelope;
    eventHandlers.forEach((handler) => handler(envelope.payload));
  }
};

export function requestToPlugin<T extends PluginRequestType>(
  type: T,
  params?: Omit<Extract<PluginRequest, { type: T }>, "type">
): Promise<ResponseMap[T]> {
  const requestId = `req_${++requestCounter}_${Date.now()}`;
  const payload = { type, ...params } as PluginRequest;
  const envelope: RequestEnvelope = { kind: "request", requestId, payload };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    parent.postMessage({ pluginMessage: envelope }, "*");

    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Request ${type} timed out`));
      }
    }, 30000);
  });
}

export function onPluginEvent(handler: EventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}
```

**Step 2: Create sandbox-side messenger**

```typescript
// src/sandbox/messenger.ts
import type {
  PluginRequest,
  PluginRequestType,
  ResponseMap,
  RequestEnvelope,
  ResponseEnvelope,
  EventEnvelope,
  PluginEvent,
} from "../shared/messages";

type RequestHandler<T extends PluginRequestType> = (
  params: Omit<Extract<PluginRequest, { type: T }>, "type">
) => Promise<ResponseMap[T]>;

const handlers = new Map<string, RequestHandler<any>>();

export function onRequestFromUI<T extends PluginRequestType>(
  type: T,
  handler: RequestHandler<T>
): void {
  handlers.set(type, handler);
}

export function emitToUI(event: PluginEvent): void {
  const envelope: EventEnvelope = { kind: "event", payload: event };
  figma.ui.postMessage(envelope);
}

// Initialize message listener
export function initMessenger(): void {
  figma.ui.onmessage = async (msg: any) => {
    if (msg.kind !== "request") return;

    const envelope = msg as RequestEnvelope;
    const handler = handlers.get(envelope.payload.type);

    const response: ResponseEnvelope = {
      kind: "response",
      requestId: envelope.requestId,
      payload: { error: `No handler for ${envelope.payload.type}` },
    };

    if (handler) {
      try {
        const { type, ...params } = envelope.payload;
        const result = await handler(params as any);
        response.payload = result;
      } catch (err) {
        response.payload = {
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    figma.ui.postMessage(response);
  };
}
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: 통과.

**Step 4: Commit**

```bash
git add src/ui/lib/messenger.ts src/sandbox/messenger.ts
git commit -m "feat: add type-safe postMessage messenger system"
```

---

### Task 4: Sandbox Core — Hash & Mapping

**Files:**
- Create: `figma-sync-plugin/src/sandbox/hash.ts`
- Create: `figma-sync-plugin/src/sandbox/mapping.ts`

**Step 1: Create hash utility**

```typescript
// src/sandbox/hash.ts

// djb2 hash — lightweight, no crypto API needed in sandbox
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

interface VisualProps {
  type: string;
  width: number;
  height: number;
  fills?: readonly Paint[] | typeof figma.mixed;
  strokes?: readonly Paint[];
  cornerRadius?: number | typeof figma.mixed;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  children?: VisualProps[];
}

function extractVisualProps(node: SceneNode): VisualProps {
  const props: VisualProps = {
    type: node.type,
    width: Math.round(node.width),
    height: Math.round(node.height),
  };

  if ("fills" in node) props.fills = node.fills;
  if ("strokes" in node) props.strokes = node.strokes;
  if ("cornerRadius" in node) props.cornerRadius = node.cornerRadius;

  if ("paddingTop" in node) {
    props.paddingTop = node.paddingTop;
    props.paddingRight = node.paddingRight;
    props.paddingBottom = node.paddingBottom;
    props.paddingLeft = node.paddingLeft;
  }

  if ("layoutMode" in node) {
    props.layoutMode = node.layoutMode;
    props.itemSpacing = node.itemSpacing;
  }

  if ("children" in node) {
    props.children = (node.children as SceneNode[]).map(extractVisualProps);
  }

  return props;
}

export function computeFigmaHash(node: SceneNode): string {
  const props = extractVisualProps(node);
  return djb2(JSON.stringify(props));
}
```

**Step 2: Create mapping CRUD**

```typescript
// src/sandbox/mapping.ts
import type { MappingEntry, GlobalConfig } from "../shared/types";
import { computeFigmaHash } from "./hash";

const GLOBAL_KEY = "figma-sync-config";
const MAPPING_KEY = "figma-sync-mapping";
const MAPPINGS_LIST_KEY = "figma-sync-mappings-list";

// --- Global Config ---

export function getGlobalConfig(): GlobalConfig | null {
  const raw = figma.root.getPluginData(GLOBAL_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return null;
  }
}

export function setGlobalConfig(config: GlobalConfig): void {
  figma.root.setPluginData(GLOBAL_KEY, JSON.stringify(config));
}

// --- Mapping List (nodeIds tracked at root level) ---

function getMappingNodeIds(): string[] {
  const raw = figma.root.getPluginData(MAPPINGS_LIST_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function setMappingNodeIds(ids: string[]): void {
  figma.root.setPluginData(MAPPINGS_LIST_KEY, JSON.stringify(ids));
}

// --- Per-Node Mapping ---

export function getNodeMapping(node: BaseNode): MappingEntry | null {
  const raw = node.getPluginData(MAPPING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MappingEntry;
  } catch {
    return null;
  }
}

function setNodeMapping(node: BaseNode, entry: MappingEntry): void {
  node.setPluginData(MAPPING_KEY, JSON.stringify(entry));
}

// --- CRUD ---

export function linkComponent(
  nodeId: string,
  codePath: string,
  componentName: string
): boolean {
  const node = figma.getNodeById(nodeId);
  if (!node) return false;

  const figmaHash = computeFigmaHash(node as SceneNode);
  const entry: MappingEntry = {
    nodeId,
    linkedFile: codePath,
    componentName,
    figmaHash,
    codeHash: "",
    lastSyncedHash: figmaHash,
    lastSyncedAt: new Date().toISOString(),
    lastSyncSource: "figma",
  };

  setNodeMapping(node, entry);

  // Add to global list
  const ids = getMappingNodeIds();
  if (!ids.includes(nodeId)) {
    ids.push(nodeId);
    setMappingNodeIds(ids);
  }

  return true;
}

export function unlinkComponent(nodeId: string): boolean {
  const node = figma.getNodeById(nodeId);
  if (!node) return false;

  node.setPluginData(MAPPING_KEY, "");

  const ids = getMappingNodeIds().filter((id) => id !== nodeId);
  setMappingNodeIds(ids);

  return true;
}

export function getAllMappings(): MappingEntry[] {
  const ids = getMappingNodeIds();
  const mappings: MappingEntry[] = [];

  for (const id of ids) {
    const node = figma.getNodeById(id);
    if (!node) continue;

    const entry = getNodeMapping(node);
    if (!entry) continue;

    // Recalculate current figma hash
    entry.figmaHash = computeFigmaHash(node as SceneNode);
    mappings.push(entry);
  }

  return mappings;
}

export function updateFigmaHash(nodeId: string): string | null {
  const node = figma.getNodeById(nodeId);
  if (!node) return null;

  const entry = getNodeMapping(node);
  if (!entry) return null;

  const newHash = computeFigmaHash(node as SceneNode);
  entry.figmaHash = newHash;
  entry.lastSyncedHash = newHash;
  entry.lastSyncedAt = new Date().toISOString();
  entry.lastSyncSource = "figma";
  setNodeMapping(node, entry);

  return newHash;
}
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: 통과.

**Step 4: Commit**

```bash
git add src/sandbox/hash.ts src/sandbox/mapping.ts
git commit -m "feat: add hash computation and mapping CRUD for sandbox"
```

---

### Task 5: Sandbox Controller — Wire It Up

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/controller.ts`

**Step 1: Wire controller with messenger and mapping**

```typescript
// src/sandbox/controller.ts
import { initMessenger, onRequestFromUI, emitToUI } from "./messenger";
import {
  getAllMappings,
  linkComponent,
  unlinkComponent,
  updateFigmaHash,
} from "./mapping";

figma.showUI(__html__, { width: 400, height: 600 });
initMessenger();

// Selection change → notify UI
figma.on("selectionchange", () => {
  const node = figma.currentPage.selection[0];
  emitToUI({
    type: "SELECTION_CHANGED",
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null,
  });
});

// Request handlers
onRequestFromUI("GET_MAPPINGS", async () => {
  return { mappings: getAllMappings() };
});

onRequestFromUI("LINK_COMPONENT", async ({ nodeId, codePath, componentName }) => {
  return { success: linkComponent(nodeId, codePath, componentName) };
});

onRequestFromUI("UNLINK_COMPONENT", async ({ nodeId }) => {
  return { success: unlinkComponent(nodeId) };
});

onRequestFromUI("UPDATE_FIGMA_HASH", async ({ nodeId }) => {
  const hash = updateFigmaHash(nodeId);
  return { hash: hash ?? "" };
});

onRequestFromUI("GET_SELECTED_NODE", async () => {
  const node = figma.currentPage.selection[0];
  return {
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null,
  };
});
```

**Step 2: Build and verify**

```bash
npm run build
npm run typecheck
```

Expected: `dist/code.js` 생성, typecheck 통과.

**Step 3: Commit**

```bash
git add src/sandbox/controller.ts
git commit -m "feat: wire sandbox controller with messenger and mapping handlers"
```

---

### Task 6: UI — GitHub Client & Storage

**Files:**
- Create: `figma-sync-plugin/src/ui/lib/github.ts`
- Create: `figma-sync-plugin/src/ui/lib/storage.ts`

**Step 1: Create clientStorage wrapper**

```typescript
// src/ui/lib/storage.ts

// clientStorage is accessed via postMessage to sandbox.
// But for simplicity in MVP, we store GitHub token in the UI
// using a dedicated message pair.

const STORAGE_PREFIX = "figma-sync:";

// For clientStorage, we need to go through the sandbox.
// In MVP, we use a simpler approach: store in memory + send to sandbox for persistence.

let cachedToken: string | null = null;

export function setToken(token: string): void {
  cachedToken = token;
  // Persist via sandbox clientStorage
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

// Called on init to load token from sandbox
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

// Handle storage response from sandbox
export function handleStorageMessage(msg: any): boolean {
  if (msg.kind === "storage-response") {
    if (msg.key === "github-token") {
      cachedToken = msg.value ?? null;
    }
    return true;
  }
  return false;
}
```

**Step 2: Create GitHub API client**

```typescript
// src/ui/lib/github.ts
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

export async function getFileSha(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string> {
  const data = await githubFetch<GitHubFileResponse>(
    `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
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
      // File might not exist yet
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
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: 통과.

**Step 4: Commit**

```bash
git add src/ui/lib/
git commit -m "feat: add GitHub API client and clientStorage wrapper"
```

---

### Task 7: Sandbox — clientStorage Handler

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/controller.ts`

**Step 1: Add clientStorage message handling to controller**

`figma.ui.onmessage`가 messenger에 의해 관리되고 있으므로, messenger 초기화 전에 storage 메시지를 가로채는 로직을 추가한다.

Modify `src/sandbox/messenger.ts` — `initMessenger` 함수에서 storage 메시지도 처리:

```typescript
// src/sandbox/messenger.ts — initMessenger 함수 수정

export function initMessenger(): void {
  figma.ui.onmessage = async (msg: any) => {
    // Handle storage messages
    if (msg.kind === "storage") {
      if (msg.action === "get") {
        const value = await figma.clientStorage.getAsync(msg.key);
        figma.ui.postMessage({
          kind: "storage-response",
          key: msg.key,
          value,
        });
        return;
      }
      if (msg.action === "set") {
        await figma.clientStorage.setAsync(msg.key, msg.value);
        return;
      }
    }

    // Handle request messages
    if (msg.kind !== "request") return;

    const envelope = msg as RequestEnvelope;
    const handler = handlers.get(envelope.payload.type);

    const response: ResponseEnvelope = {
      kind: "response",
      requestId: envelope.requestId,
      payload: { error: `No handler for ${envelope.payload.type}` },
    };

    if (handler) {
      try {
        const { type, ...params } = envelope.payload;
        const result = await handler(params as any);
        response.payload = result;
      } catch (err) {
        response.payload = {
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    figma.ui.postMessage(response);
  };
}
```

**Step 2: Verify build**

```bash
npm run build
npm run typecheck
```

Expected: 통과.

**Step 3: Commit**

```bash
git add src/sandbox/messenger.ts
git commit -m "feat: add clientStorage handling to sandbox messenger"
```

---

### Task 8: UI — StatusBadge & ComponentCard

**Files:**
- Create: `figma-sync-plugin/src/ui/components/StatusBadge.tsx`
- Create: `figma-sync-plugin/src/ui/components/ComponentCard.tsx`

**Step 1: Create StatusBadge**

```tsx
// src/ui/components/StatusBadge.tsx
import type { SyncState } from "../../shared/types";

const config: Record<SyncState, { label: string; color: string }> = {
  synced: { label: "Synced", color: "bg-green-100 text-green-700" },
  figma_changed: { label: "Figma changed", color: "bg-blue-100 text-blue-700" },
  code_changed: { label: "Code changed", color: "bg-orange-100 text-orange-700" },
  conflict: { label: "Conflict", color: "bg-red-100 text-red-700" },
  not_linked: { label: "Not linked", color: "bg-gray-100 text-gray-500" },
};

export default function StatusBadge({ state }: { state: SyncState }) {
  const { label, color } = config[state];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
```

**Step 2: Create ComponentCard**

```tsx
// src/ui/components/ComponentCard.tsx
import type { SyncState } from "../../shared/types";
import StatusBadge from "./StatusBadge";

interface ComponentCardProps {
  componentName: string;
  codePath: string;
  state: SyncState;
  onUnlink: () => void;
}

export default function ComponentCard({
  componentName,
  codePath,
  state,
  onUnlink,
}: ComponentCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{componentName}</span>
        <StatusBadge state={state} />
      </div>
      <div className="text-xs text-gray-500 mb-2 font-mono">{codePath}</div>
      <div className="flex gap-2">
        <button
          onClick={onUnlink}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Unlink
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: 통과.

**Step 4: Commit**

```bash
git add src/ui/components/
git commit -m "feat: add StatusBadge and ComponentCard UI components"
```

---

### Task 9: UI — SettingsView

**Files:**
- Create: `figma-sync-plugin/src/ui/pages/SettingsView.tsx`

**Step 1: Create SettingsView**

```tsx
// src/ui/pages/SettingsView.tsx
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
  const [tokenInput, setTokenInput] = useState(token ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    // Parse repo URL
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
```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/ui/pages/SettingsView.tsx
git commit -m "feat: add SettingsView page"
```

---

### Task 10: UI — LinkView

**Files:**
- Create: `figma-sync-plugin/src/ui/pages/LinkView.tsx`

**Step 1: Create LinkView**

```tsx
// src/ui/pages/LinkView.tsx
import { useState } from "react";

interface LinkViewProps {
  selectedNodeId: string | null;
  selectedNodeName: string | null;
  basePath: string;
  onLink: (nodeId: string, codePath: string, componentName: string) => void;
  onCancel: () => void;
}

export default function LinkView({
  selectedNodeId,
  selectedNodeName,
  basePath,
  onLink,
  onCancel,
}: LinkViewProps) {
  const suggestedName = selectedNodeName ?? "";
  const [componentName, setComponentName] = useState(suggestedName);
  const [filePath, setFilePath] = useState(
    suggestedName ? `${basePath}/${suggestedName}.tsx` : ""
  );
  const [error, setError] = useState<string | null>(null);

  function handleLink() {
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
    onLink(selectedNodeId, filePath.trim(), componentName.trim());
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

      <label className="block mb-4">
        <span className="block text-xs font-medium text-gray-700 mb-1">Code File Path</span>
        <input
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="src/components/compCard.tsx"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
        />
      </label>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleLink}
          disabled={!selectedNodeId}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Link
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/ui/pages/LinkView.tsx
git commit -m "feat: add LinkView page"
```

---

### Task 11: UI — MainView

**Files:**
- Create: `figma-sync-plugin/src/ui/pages/MainView.tsx`

**Step 1: Create MainView**

```tsx
// src/ui/pages/MainView.tsx
import { useState, useEffect } from "react";
import type { MappingEntry, SyncState, GlobalConfig } from "../../shared/types";
import { requestToPlugin } from "../lib/messenger";
import { getFileShas } from "../lib/github";
import ComponentCard from "../components/ComponentCard";

interface MappingWithState extends MappingEntry {
  state: SyncState;
}

interface MainViewProps {
  config: GlobalConfig;
  onLinkNew: () => void;
  onSettings: () => void;
}

function computeState(mapping: MappingEntry, currentCodeHash: string): SyncState {
  const figmaChanged = mapping.figmaHash !== mapping.lastSyncedHash;
  const codeChanged =
    currentCodeHash !== "" && currentCodeHash !== mapping.codeHash && mapping.codeHash !== "";

  // If codeHash was never set (first link), only check figma
  if (mapping.codeHash === "") {
    return figmaChanged ? "figma_changed" : "synced";
  }

  if (figmaChanged && codeChanged) return "conflict";
  if (figmaChanged) return "figma_changed";
  if (codeChanged) return "code_changed";
  return "synced";
}

export default function MainView({ config, onLinkNew, onSettings }: MainViewProps) {
  const [mappings, setMappings] = useState<MappingWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const { mappings: rawMappings } = await requestToPlugin("GET_MAPPINGS");

      // Fetch code SHAs from GitHub
      const paths = rawMappings.map((m) => m.linkedFile);
      const shas = await getFileShas(
        config.repoOwner,
        config.repoName,
        paths,
        config.branch
      );

      const withState: MappingWithState[] = rawMappings.map((m) => ({
        ...m,
        state: computeState(m, shas.get(m.linkedFile) ?? ""),
      }));

      setMappings(withState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleUnlink(nodeId: string) {
    await requestToPlugin("UNLINK_COMPONENT", { nodeId });
    refresh();
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-base font-semibold">Figma Sync</h1>
        <button onClick={onSettings} className="text-gray-400 hover:text-gray-600 text-lg">
          &#9881;
        </button>
      </div>

      <div className="text-xs text-gray-500 mb-4">
        {config.repoOwner}/{config.repoName} &middot; {config.branch}
      </div>

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-sm text-gray-400 py-8">Loading...</div>
      ) : mappings.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-8">
          No linked components yet.
        </div>
      ) : (
        <div className="mb-4">
          {mappings.map((m) => (
            <ComponentCard
              key={m.nodeId}
              componentName={m.componentName}
              codePath={m.linkedFile}
              state={m.state}
              onUnlink={() => handleUnlink(m.nodeId)}
            />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onLinkNew}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Link Component
        </button>
        <button
          onClick={refresh}
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/ui/pages/MainView.tsx
git commit -m "feat: add MainView page with sync state display"
```

---

### Task 12: UI — App.tsx (Wire All Pages)

**Files:**
- Modify: `figma-sync-plugin/src/ui/App.tsx`

**Step 1: Wire App with all pages and messenger**

```tsx
// src/ui/App.tsx
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

  // Load initial state
  useEffect(() => {
    // Listen for storage responses
    const originalOnMessage = window.onmessage;
    window.onmessage = (e: MessageEvent) => {
      const msg = e.data.pluginMessage;
      if (msg && handleStorageMessage(msg)) {
        // After token is loaded, check if we have config
        if (getToken() && config) {
          setPage("main");
        }
        return;
      }
      // Pass to messenger handler
      if (originalOnMessage) {
        originalOnMessage.call(window, e);
      }
    };

    requestStoredToken();

    // Listen for selection changes
    const unsubscribe = onPluginEvent((event) => {
      if (event.type === "SELECTION_CHANGED") {
        setSelectedNodeId(event.nodeId);
        setSelectedNodeName(event.nodeName);
      }
    });

    return unsubscribe;
  }, []);

  // Load config from sandbox (stored in root pluginData)
  useEffect(() => {
    // TODO: Add GET_CONFIG request in Phase 2
    // For now, config is set via SettingsView
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
```

**Step 2: Build and verify everything**

```bash
npm run build
npm run typecheck
```

Expected: `dist/code.js`와 `dist/index.html` 모두 생성, typecheck 통과.

**Step 3: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire App.tsx with page routing and messenger integration"
```

---

### Task 13: Manual Testing in Figma

**Step 1: Open in Figma Desktop**

1. Figma Desktop 열기
2. Plugins → Development → Import plugin from manifest
3. `figma-sync-plugin/manifest.json` 선택
4. 새 파일에서 Plugins → Development → Figma Sync 실행

**Step 2: Verify basic flow**

1. Settings 화면이 보이는지 확인
2. GitHub repo URL, token 입력 → Save
3. Main 화면으로 전환되는지 확인
4. 컴포넌트 선택 → Link Component → 경로 입력 → Link
5. Main 화면에 카드가 표시되는지 확인
6. Refresh 클릭 → GitHub SHA 조회되는지 확인

**Step 3: Fix any issues found during manual testing**

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: adjustments from manual Figma testing"
```

---

## Summary

| Task | 내용 | 예상 파일 수 |
|------|------|-------------|
| 1 | Project scaffolding | 11 |
| 2 | Shared types | 2 |
| 3 | Messenger system | 2 |
| 4 | Hash & Mapping | 2 |
| 5 | Sandbox controller wiring | 1 |
| 6 | GitHub client & storage | 2 |
| 7 | clientStorage handler | 1 |
| 8 | StatusBadge & ComponentCard | 2 |
| 9 | SettingsView | 1 |
| 10 | LinkView | 1 |
| 11 | MainView | 1 |
| 12 | App.tsx wiring | 1 |
| 13 | Manual testing in Figma | 0 |
