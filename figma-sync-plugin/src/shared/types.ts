export interface MappingEntry {
  kind: "component" | "style" | "variable";
  nodeId: string;
  linkedFile: string;
  componentName: string;
  figmaHash: string;
  codeHash: string;
  lastSyncedHash: string;
  lastSyncedAt: string;
  lastSyncSource: "figma" | "code";
  lastSyncedSnapshot?: FlatSnapshot;
  tokenSnapshot?: TokenSnapshot;
}

export interface FlatSnapshot {
  type: string;
  width: number;
  height: number;
  fills: string;
  strokes: string;
  cornerRadius: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  layoutMode: string;
  itemSpacing: number;
  childCount: number;
}

export interface VariableSnapshotEntry {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  collectionName: string;
  valuesByMode: Record<string, string>;
  codeSyntax?: string;
}

export interface StyleSnapshotEntry {
  id: string;
  name: string;
  styleType: "PAINT" | "TEXT" | "EFFECT" | "GRID";
  paints?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  effects?: string;
}

export type TokenSnapshot =
  | { kind: "variables"; entries: VariableSnapshotEntry[] }
  | { kind: "styles"; entries: StyleSnapshotEntry[] };

export interface GlobalConfig {
  repoOwner: string;
  repoName: string;
  branch: string;
  basePath: string;
  framework: "react" | "vue";
  styling: "tailwind" | "css-modules";
  tokenFile: string;
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
