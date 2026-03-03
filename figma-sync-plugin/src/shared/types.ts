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
  styleType: "PAINT" | "TEXT" | "EFFECT";
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

// --- Component Descriptor JSON Schema ---

export interface ComponentDescriptorFill {
  type: "SOLID";
  color: string;
  opacity?: number;
  boundVariable?: string;
}

export interface ComponentDescriptorStroke {
  type: "SOLID";
  color: string;
  opacity?: number;
  weight?: number;
  boundVariable?: string;
}

export interface ComponentDescriptorEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  color?: string;
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
  visible?: boolean;
}

export interface ComponentDescriptorLayout {
  mode: "HORIZONTAL" | "VERTICAL" | "NONE";
  padding?: { top: number; right: number; bottom: number; left: number };
  itemSpacing?: number;
  primaryAxisAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlign?: "MIN" | "CENTER" | "MAX";
  primaryAxisSizing?: "FIXED" | "AUTO";
  counterAxisSizing?: "FIXED" | "AUTO";
}

export interface ComponentDescriptorStyles {
  fills?: ComponentDescriptorFill[];
  strokes?: ComponentDescriptorStroke[];
  effects?: ComponentDescriptorEffect[];
  cornerRadius?: number | { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  width?: number;
  height?: number;
}

export interface ComponentDescriptorTextStyles {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  lineHeight?: number | { value: number; unit: "PIXELS" | "PERCENT" | "AUTO" };
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  fills?: ComponentDescriptorFill[];
}

export interface ComponentDescriptorProperty {
  name: string;
  type: "VARIANT" | "BOOLEAN" | "TEXT" | "INSTANCE_SWAP";
  options?: string[];
  default: string | boolean | null;
}

export interface ComponentDescriptorChild {
  type: "FRAME" | "TEXT" | "INSTANCE" | "RECTANGLE" | "ELLIPSE" | "VECTOR";
  name: string;
  bindTo?: string;
  componentRef?: string;
  layout?: ComponentDescriptorLayout;
  styles?: ComponentDescriptorStyles;
  textStyles?: ComponentDescriptorTextStyles;
  textContent?: string;
  children?: ComponentDescriptorChild[];
}

export interface ComponentDescriptorVariantOverride {
  props: Record<string, string>;
  overrides: {
    styles?: Partial<ComponentDescriptorStyles>;
    layout?: Partial<ComponentDescriptorLayout>;
    children?: Record<string, {
      styles?: Partial<ComponentDescriptorStyles>;
      textStyles?: Partial<ComponentDescriptorTextStyles>;
      textContent?: string;
    }>;
  };
}

export interface ComponentDescriptor {
  $schema: string;
  name: string;
  description?: string;
  properties?: ComponentDescriptorProperty[];
  layout?: ComponentDescriptorLayout;
  styles?: ComponentDescriptorStyles;
  children?: ComponentDescriptorChild[];
  variants?: ComponentDescriptorVariantOverride[];
}
