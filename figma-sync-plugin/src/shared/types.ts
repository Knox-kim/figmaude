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
