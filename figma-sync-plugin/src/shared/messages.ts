import type { MappingEntry, SyncStatus, GlobalConfig } from "./types";

// --- UI → Sandbox requests ---

export type PluginRequest =
  | { type: "GET_MAPPINGS" }
  | { type: "LINK_COMPONENT"; nodeId: string; codePath: string; componentName: string }
  | { type: "UNLINK_COMPONENT"; nodeId: string }
  | { type: "UPDATE_FIGMA_HASH"; nodeId: string }
  | { type: "GET_SELECTED_NODE" }
  | { type: "GET_CONFIG" }
  | { type: "SET_CONFIG"; config: GlobalConfig }
  | { type: "UPDATE_CODE_HASH"; nodeId: string; codeHash: string };

export type PluginRequestType = PluginRequest["type"];

export interface ResponseMap {
  GET_MAPPINGS: { mappings: MappingEntry[] };
  LINK_COMPONENT: { success: boolean };
  UNLINK_COMPONENT: { success: boolean };
  UPDATE_FIGMA_HASH: { hash: string };
  GET_SELECTED_NODE: { nodeId: string | null; nodeName: string | null };
  GET_CONFIG: { config: GlobalConfig | null };
  SET_CONFIG: { success: boolean };
  UPDATE_CODE_HASH: { success: boolean };
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
