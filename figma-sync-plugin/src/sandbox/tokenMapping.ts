import type { MappingEntry, VariableSnapshotEntry, StyleSnapshotEntry, TokenSnapshot } from "../shared/types";
import { computeVariablesHash, computeStylesHash, type RawVariableData, type RawStyleData } from "./hash";

const VARIABLES_KEY = "figma-sync-all-variables";
const STYLES_KEY = "figma-sync-all-styles";

// --- Scan all local variables ---

export async function scanVariables(): Promise<RawVariableData[]> {
  const variables = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionMap = new Map(collections.map((c) => [c.id, c.name]));

  // Build id→name lookup for resolving aliases
  const variableNameById = new Map(variables.map((v) => [v.id, v.name]));

  return variables.map((v) => {
    const serializedValues: Record<string, string> = {};
    for (const [modeId, value] of Object.entries(v.valuesByMode)) {
      // Detect VariableAlias: { type: "VARIABLE_ALIAS", id: "VariableID:xxx" }
      if (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        (value as { type: string }).type === "VARIABLE_ALIAS"
      ) {
        const aliasId = (value as { id: string }).id;
        const aliasName = variableNameById.get(aliasId);
        if (aliasName) {
          serializedValues[modeId] = JSON.stringify({ __alias: aliasName });
        } else {
          // Alias target not found locally — serialize raw value as fallback
          serializedValues[modeId] = JSON.stringify(value);
        }
      } else {
        serializedValues[modeId] = JSON.stringify(value);
      }
    }

    return {
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      collectionName: collectionMap.get(v.variableCollectionId) ?? "Unknown",
      valuesByMode: serializedValues,
      codeSyntax: v.codeSyntax?.WEB,
    };
  });
}

// --- Scan all local styles ---

export async function scanStyles(): Promise<RawStyleData[]> {
  const [paintStyles, textStyles, effectStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
  ]);

  const styles: RawStyleData[] = [];

  for (const s of paintStyles) {
    styles.push({
      id: s.id,
      name: s.name,
      styleType: "PAINT",
      paints: JSON.stringify(s.paints),
    });
  }

  for (const s of textStyles) {
    styles.push({
      id: s.id,
      name: s.name,
      styleType: "TEXT",
      fontSize: s.fontSize,
      fontFamily: s.fontName.family,
      fontWeight: s.fontName.style,
      lineHeight: JSON.stringify(s.lineHeight),
      letterSpacing: JSON.stringify(s.letterSpacing),
    });
  }

  for (const s of effectStyles) {
    styles.push({
      id: s.id,
      name: s.name,
      styleType: "EFFECT",
      effects: JSON.stringify(s.effects),
    });
  }

  return styles;
}

// --- Mode info helper ---

export async function getModeInfo(): Promise<{
  modeMap: Array<[string, string]>;
  defaultModes: Array<[string, string]>;
}> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const modeMap: Array<[string, string]> = [];
  const defaultModes: Array<[string, string]> = [];
  for (const c of collections) {
    defaultModes.push([c.name, c.defaultModeId]);
    for (const m of c.modes) {
      modeMap.push([m.modeId, m.name]);
    }
  }
  return { modeMap, defaultModes };
}

// --- Snapshot helpers ---

function toVariableSnapshot(rawVars: RawVariableData[]): TokenSnapshot {
  return {
    kind: "variables",
    entries: rawVars.map((v) => ({
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType as VariableSnapshotEntry["resolvedType"],
      collectionName: v.collectionName,
      valuesByMode: v.valuesByMode as Record<string, string>,
      codeSyntax: v.codeSyntax,
    })),
  };
}

function toStyleSnapshot(rawStyles: RawStyleData[]): TokenSnapshot {
  return {
    kind: "styles",
    entries: rawStyles.map((s) => ({
      id: s.id,
      name: s.name,
      styleType: s.styleType as StyleSnapshotEntry["styleType"],
      paints: s.paints,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      effects: s.effects,
    })),
  };
}

// --- Storage: single aggregate entries ---

function getTokenMapping(key: string): MappingEntry | null {
  const raw = figma.root.getPluginData(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MappingEntry;
  } catch {
    return null;
  }
}

function setTokenMapping(key: string, entry: MappingEntry): void {
  figma.root.setPluginData(key, JSON.stringify(entry));
}

function clearTokenMapping(key: string): void {
  figma.root.setPluginData(key, "");
}

// --- Variables CRUD ---

export async function getVariablesMapping(): Promise<{
  mapping: MappingEntry | null;
  currentSnapshot: TokenSnapshot | null;
}> {
  const mapping = getTokenMapping(VARIABLES_KEY);
  if (!mapping) return { mapping: null, currentSnapshot: null };

  const rawVars = await scanVariables();
  mapping.figmaHash = computeVariablesHash(rawVars);

  const currentSnapshot = toVariableSnapshot(rawVars);

  return { mapping, currentSnapshot };
}

export async function linkVariables(tokenFile: string): Promise<boolean> {
  const rawVars = await scanVariables();
  const hash = computeVariablesHash(rawVars);

  const entry: MappingEntry = {
    kind: "variable",
    nodeId: "__variables__",
    linkedFile: tokenFile,
    componentName: "Variables",
    figmaHash: hash,
    codeHash: "",
    lastSyncedHash: hash,
    lastSyncedAt: new Date().toISOString(),
    lastSyncSource: "figma",
    tokenSnapshot: toVariableSnapshot(rawVars),
  };

  setTokenMapping(VARIABLES_KEY, entry);
  return true;
}

export function unlinkVariables(): boolean {
  clearTokenMapping(VARIABLES_KEY);
  return true;
}

export async function updateVariablesHash(): Promise<string> {
  const mapping = getTokenMapping(VARIABLES_KEY);
  if (!mapping) return "";

  const rawVars = await scanVariables();
  const newHash = computeVariablesHash(rawVars);

  mapping.figmaHash = newHash;
  mapping.lastSyncedHash = newHash;
  mapping.lastSyncedAt = new Date().toISOString();
  mapping.lastSyncSource = "figma";
  mapping.tokenSnapshot = toVariableSnapshot(rawVars);

  setTokenMapping(VARIABLES_KEY, mapping);
  return newHash;
}

export function updateVariablesCodeHash(codeHash: string): boolean {
  const mapping = getTokenMapping(VARIABLES_KEY);
  if (!mapping) return false;
  mapping.codeHash = codeHash;
  setTokenMapping(VARIABLES_KEY, mapping);
  return true;
}

// --- Styles CRUD ---

export async function getStylesMapping(): Promise<{
  mapping: MappingEntry | null;
  currentSnapshot: TokenSnapshot | null;
}> {
  const mapping = getTokenMapping(STYLES_KEY);
  if (!mapping) return { mapping: null, currentSnapshot: null };

  const rawStyles = await scanStyles();
  mapping.figmaHash = computeStylesHash(rawStyles);

  const currentSnapshot = toStyleSnapshot(rawStyles);

  return { mapping, currentSnapshot };
}

export async function linkStyles(tokenFile: string): Promise<boolean> {
  const rawStyles = await scanStyles();
  const hash = computeStylesHash(rawStyles);

  const entry: MappingEntry = {
    kind: "style",
    nodeId: "__styles__",
    linkedFile: tokenFile,
    componentName: "Styles",
    figmaHash: hash,
    codeHash: "",
    lastSyncedHash: hash,
    lastSyncedAt: new Date().toISOString(),
    lastSyncSource: "figma",
    tokenSnapshot: toStyleSnapshot(rawStyles),
  };

  setTokenMapping(STYLES_KEY, entry);
  return true;
}

export function unlinkStyles(): boolean {
  clearTokenMapping(STYLES_KEY);
  return true;
}

export async function updateStylesHash(): Promise<string> {
  const mapping = getTokenMapping(STYLES_KEY);
  if (!mapping) return "";

  const rawStyles = await scanStyles();
  const newHash = computeStylesHash(rawStyles);

  mapping.figmaHash = newHash;
  mapping.lastSyncedHash = newHash;
  mapping.lastSyncedAt = new Date().toISOString();
  mapping.lastSyncSource = "figma";
  mapping.tokenSnapshot = toStyleSnapshot(rawStyles);

  setTokenMapping(STYLES_KEY, mapping);
  return newHash;
}

export function updateStylesCodeHash(codeHash: string): boolean {
  const mapping = getTokenMapping(STYLES_KEY);
  if (!mapping) return false;
  mapping.codeHash = codeHash;
  setTokenMapping(STYLES_KEY, mapping);
  return true;
}
