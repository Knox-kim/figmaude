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

export async function linkComponent(
  nodeId: string,
  codePath: string,
  componentName: string
): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);
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

export async function unlinkComponent(nodeId: string): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;

  node.setPluginData(MAPPING_KEY, "");

  const ids = getMappingNodeIds().filter((id) => id !== nodeId);
  setMappingNodeIds(ids);

  return true;
}

export async function getAllMappings(): Promise<MappingEntry[]> {
  const ids = getMappingNodeIds();
  const mappings: MappingEntry[] = [];
  const validIds: string[] = [];

  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;

    const entry = getNodeMapping(node);
    if (!entry) continue;

    validIds.push(id);
    // Recalculate current figma hash
    entry.figmaHash = computeFigmaHash(node as SceneNode);
    mappings.push(entry);
  }

  // Clean up stale node IDs
  if (validIds.length < ids.length) {
    setMappingNodeIds(validIds);
  }

  return mappings;
}

export async function updateCodeHash(nodeId: string, codeHash: string): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;

  const entry = getNodeMapping(node);
  if (!entry) return false;

  entry.codeHash = codeHash;
  setNodeMapping(node, entry);
  return true;
}

export async function updateFigmaHash(nodeId: string): Promise<string | null> {
  const node = await figma.getNodeByIdAsync(nodeId);
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
