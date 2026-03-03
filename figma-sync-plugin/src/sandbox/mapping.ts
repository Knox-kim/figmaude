import type { MappingEntry, GlobalConfig, FlatSnapshot } from "../shared/types";
import { computeFigmaHash, extractFlatSnapshot } from "./hash";

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
  codePath: string
): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;

  const componentName = codePath.split("/").pop()?.replace(/\.\w+$/, "") ?? codePath;
  const sceneNode = node as SceneNode;
  const figmaHash = computeFigmaHash(sceneNode);
  const entry: MappingEntry = {
    kind: "component",
    nodeId,
    linkedFile: codePath,
    componentName,
    figmaNodeName: node.name,
    figmaHash,
    codeHash: "",
    lastSyncedHash: figmaHash,
    lastSyncedAt: new Date().toISOString(),
    lastSyncSource: "figma",
    lastSyncedSnapshot: extractFlatSnapshot(sceneNode),
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

export async function getAllMappings(): Promise<{
  mappings: MappingEntry[];
  currentSnapshots: Record<string, FlatSnapshot>;
}> {
  const ids = getMappingNodeIds();
  const mappings: MappingEntry[] = [];
  const currentSnapshots: Record<string, FlatSnapshot> = {};
  const validIds: string[] = [];

  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;

    const entry = getNodeMapping(node);
    if (!entry) continue;
    if (!entry.kind) entry.kind = "component";

    // Detect Figma rename: if node name changed since linking, auto-unlink
    if (entry.figmaNodeName && node.name !== entry.figmaNodeName) {
      node.setPluginData(MAPPING_KEY, "");
      continue; // skip — not added to validIds, so mapping list auto-cleans
    }

    const sceneNode = node as SceneNode;
    validIds.push(id);
    // Recalculate current figma hash
    entry.figmaHash = computeFigmaHash(sceneNode);
    currentSnapshots[id] = extractFlatSnapshot(sceneNode);
    mappings.push(entry);
  }

  // Clean up stale node IDs
  if (validIds.length < ids.length) {
    setMappingNodeIds(validIds);
  }

  return { mappings, currentSnapshots };
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

  const sceneNode = node as SceneNode;
  const newHash = computeFigmaHash(sceneNode);
  entry.figmaHash = newHash;
  entry.lastSyncedHash = newHash;
  entry.lastSyncedAt = new Date().toISOString();
  entry.lastSyncSource = "figma";
  entry.lastSyncedSnapshot = extractFlatSnapshot(sceneNode);
  setNodeMapping(node, entry);

  return newHash;
}
