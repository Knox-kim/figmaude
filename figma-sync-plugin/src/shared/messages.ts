import type { MappingEntry, SyncStatus, GlobalConfig, FlatSnapshot, TokenSnapshot, ComponentDescriptor } from "./types";

// --- UI → Sandbox requests ---

export type PluginRequest =
  | { type: "GET_MAPPINGS" }
  | { type: "LINK_COMPONENT"; nodeId: string; codePath: string }
  | { type: "UNLINK_COMPONENT"; nodeId: string }
  | { type: "UPDATE_FIGMA_HASH"; nodeId: string }
  | { type: "GET_SELECTED_NODE" }
  | { type: "GET_CONFIG" }
  | { type: "SET_CONFIG"; config: GlobalConfig }
  | { type: "UPDATE_CODE_HASH"; nodeId: string; codeHash: string }
  | { type: "SCAN_COMPONENTS" }
  | { type: "SCAN_VARIABLES" }
  | { type: "SCAN_STYLES" }
  | { type: "GET_VARIABLES_MAPPING" }
  | { type: "GET_STYLES_MAPPING" }
  | { type: "LINK_VARIABLES"; tokenFile: string }
  | { type: "LINK_STYLES"; tokenFile: string }
  | { type: "UNLINK_VARIABLES" }
  | { type: "UNLINK_STYLES" }
  | { type: "UPDATE_VARIABLES_HASH" }
  | { type: "UPDATE_STYLES_HASH" }
  | { type: "UPDATE_VARIABLES_CODE_HASH"; codeHash: string }
  | { type: "UPDATE_STYLES_CODE_HASH"; codeHash: string }
  | { type: "GENERATE_CSS" }
  | { type: "GET_FILE_KEY" }
  | { type: "APPLY_VARIABLE_VALUES"; values: ApplyVariableValuesPayload[] }
  | { type: "APPLY_STYLE_VALUES"; values: ApplyStyleValuesPayload[] }
  | { type: "APPLY_COMPONENT_JSON"; nodeId: string; json: ComponentDescriptor }
  | { type: "EXTRACT_COMPONENT_JSON"; nodeId: string };

export interface ApplyVariableValuesPayload {
  id?: string;  // Figma variable ID for stable lookup
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, string>; // modeId/modeName → JSON-serialized value
}

export interface ApplyStyleValuesPayload {
  id?: string;  // Figma style ID for stable lookup
  name: string;
  styleType: "PAINT" | "TEXT" | "EFFECT";
  paints?: string;       // JSON-serialized Paint[]
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;   // JSON-serialized LineHeight
  letterSpacing?: string; // JSON-serialized LetterSpacing
  effects?: string;      // JSON-serialized Effect[]
}

export type PluginRequestType = PluginRequest["type"];

export interface ResponseMap {
  GET_MAPPINGS: { mappings: MappingEntry[]; currentSnapshots: Record<string, FlatSnapshot> };
  LINK_COMPONENT: { success: boolean };
  UNLINK_COMPONENT: { success: boolean };
  UPDATE_FIGMA_HASH: { hash: string };
  GET_SELECTED_NODE: { nodeId: string | null; nodeName: string | null };
  GET_CONFIG: { config: GlobalConfig | null };
  SET_CONFIG: { success: boolean };
  UPDATE_CODE_HASH: { success: boolean };
  SCAN_COMPONENTS: { components: Array<{ nodeId: string; name: string }> };
  SCAN_VARIABLES: { variables: Array<{ id: string; name: string; resolvedType: string; collectionName: string }> };
  SCAN_STYLES: { styles: Array<{ id: string; name: string; styleType: string }> };
  GET_VARIABLES_MAPPING: { mapping: MappingEntry | null; currentSnapshot: TokenSnapshot | null };
  GET_STYLES_MAPPING: { mapping: MappingEntry | null; currentSnapshot: TokenSnapshot | null };
  LINK_VARIABLES: { success: boolean };
  LINK_STYLES: { success: boolean };
  UNLINK_VARIABLES: { success: boolean };
  UNLINK_STYLES: { success: boolean };
  UPDATE_VARIABLES_HASH: { hash: string };
  UPDATE_STYLES_HASH: { hash: string };
  UPDATE_VARIABLES_CODE_HASH: { success: boolean };
  UPDATE_STYLES_CODE_HASH: { success: boolean };
  GENERATE_CSS: { css: string };
  GET_FILE_KEY: { fileKey: string };
  APPLY_VARIABLE_VALUES: { success: boolean; updated: number };
  APPLY_STYLE_VALUES: { success: boolean; updated: number };
  APPLY_COMPONENT_JSON: { success: boolean; nodeId: string };
  EXTRACT_COMPONENT_JSON: { json: ComponentDescriptor };
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
