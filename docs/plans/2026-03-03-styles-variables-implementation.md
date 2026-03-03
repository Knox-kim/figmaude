# Styles & Variables Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track Figma Styles and Variables alongside components, syncing them to a CSS token file via the same hash-based conflict detection system.

**Architecture:** Extend the existing MappingEntry with a `kind` discriminator. Variables and Styles each become a single aggregate entry (one card each in the UI). A new CSS generation module converts Figma values to CSS custom properties organized by comment sections.

**Tech Stack:** TypeScript, React, Figma Plugin API (styles + variables), CSS custom properties

---

### Task 1: Extend shared types

**Files:**
- Modify: `figma-sync-plugin/src/shared/types.ts`

**Step 1: Add `kind` field and token snapshot types to types.ts**

Replace the entire file with:
```typescript
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
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/shared/types.ts
git commit -m "feat: extend MappingEntry with kind field and token snapshot types"
```

---

### Task 2: Add token hash and snapshot functions

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/hash.ts`

**Step 1: Add token hash functions after existing code**

Add these functions at the end of `hash.ts`:

```typescript
// --- Token hashing (Variables & Styles) ---

export interface RawVariableData {
  id: string;
  name: string;
  resolvedType: string;
  collectionName: string;
  valuesByMode: Record<string, unknown>;
  codeSyntax?: string;
}

export interface RawStyleData {
  id: string;
  name: string;
  styleType: string;
  paints?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  effects?: string;
}

export function computeVariablesHash(variables: RawVariableData[]): string {
  const sorted = [...variables].sort((a, b) => a.name.localeCompare(b.name));
  const serialized = sorted.map(
    (v) => `${v.name}:${v.resolvedType}:${JSON.stringify(v.valuesByMode)}`
  ).join("|");
  return djb2(serialized);
}

export function computeStylesHash(styles: RawStyleData[]): string {
  const sorted = [...styles].sort((a, b) => a.name.localeCompare(b.name));
  const serialized = sorted.map((s) => {
    const props = [s.name, s.styleType, s.paints, s.fontSize, s.fontFamily, s.fontWeight, s.lineHeight, s.letterSpacing, s.effects]
      .map(v => v ?? "")
      .join(":");
    return props;
  }).join("|");
  return djb2(serialized);
}
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/sandbox/hash.ts
git commit -m "feat: add token hash functions for variables and styles"
```

---

### Task 3: Add token scanning and mapping functions

**Files:**
- Create: `figma-sync-plugin/src/sandbox/tokenMapping.ts`

**Step 1: Create tokenMapping.ts**

```typescript
import type { MappingEntry, VariableSnapshotEntry, StyleSnapshotEntry, TokenSnapshot } from "../shared/types";
import { computeVariablesHash, computeStylesHash, type RawVariableData, type RawStyleData } from "./hash";

const VARIABLES_KEY = "figma-sync-all-variables";
const STYLES_KEY = "figma-sync-all-styles";

// --- Scan all local variables ---

export async function scanVariables(): Promise<RawVariableData[]> {
  const variables = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionMap = new Map(collections.map((c) => [c.id, c.name]));

  return variables.map((v) => {
    const serializedValues: Record<string, string> = {};
    for (const [modeId, value] of Object.entries(v.valuesByMode)) {
      serializedValues[modeId] = JSON.stringify(value);
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

  const currentSnapshot: TokenSnapshot = {
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
    tokenSnapshot: {
      kind: "variables",
      entries: rawVars.map((v) => ({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType as VariableSnapshotEntry["resolvedType"],
        collectionName: v.collectionName,
        valuesByMode: v.valuesByMode as Record<string, string>,
        codeSyntax: v.codeSyntax,
      })),
    },
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
  mapping.tokenSnapshot = {
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

  const currentSnapshot: TokenSnapshot = {
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
    tokenSnapshot: {
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
    },
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
  mapping.tokenSnapshot = {
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
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/sandbox/tokenMapping.ts
git commit -m "feat: add token mapping CRUD for variables and styles"
```

---

### Task 4: Extend message types

**Files:**
- Modify: `figma-sync-plugin/src/shared/messages.ts`

**Step 1: Add token request/response types**

Add new request types to the `PluginRequest` union (before the semicolon on line 14):
```typescript
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
```

Add to `ResponseMap` (import `TokenSnapshot` and scan types):
```typescript
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
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/shared/messages.ts
git commit -m "feat: add message types for token scanning and sync"
```

---

### Task 5: Add CSS generation utility

**Files:**
- Create: `figma-sync-plugin/src/sandbox/cssGenerator.ts`

**Step 1: Create cssGenerator.ts**

```typescript
import type { RawVariableData, RawStyleData } from "./hash";

function toKebab(name: string): string {
  return name.replace(/\//g, "-").replace(/\s+/g, "-").toLowerCase();
}

function rgbaToHex(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const v = value as Record<string, number>;
  if ("r" in v && "g" in v && "b" in v) {
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
    const hex = `#${toHex(v.r)}${toHex(v.g)}${toHex(v.b)}`;
    if ("a" in v && v.a < 1) {
      return `${hex}${toHex(v.a)}`;
    }
    return hex;
  }
  return String(value);
}

function formatVariableValue(resolvedType: string, rawValue: string): string {
  try {
    const value = JSON.parse(rawValue);
    if (resolvedType === "COLOR") return rgbaToHex(value);
    if (resolvedType === "FLOAT") return typeof value === "number" ? `${value}px` : String(value);
    if (resolvedType === "STRING") return `"${value}"`;
    if (resolvedType === "BOOLEAN") return String(value);
    return String(value);
  } catch {
    return rawValue;
  }
}

export function generateCSS(variables: RawVariableData[], styles: RawStyleData[]): string {
  const lines: string[] = [":root {"];

  // Group variables by collection
  const collections = new Map<string, RawVariableData[]>();
  for (const v of variables) {
    const group = collections.get(v.collectionName) ?? [];
    group.push(v);
    collections.set(v.collectionName, group);
  }

  for (const [collectionName, vars] of collections) {
    lines.push(`  /* === Collection: ${collectionName} === */`);
    const sorted = [...vars].sort((a, b) => a.name.localeCompare(b.name));
    for (const v of sorted) {
      // Use default mode (first entry in valuesByMode)
      const modeEntries = Object.entries(v.valuesByMode);
      const defaultValue = modeEntries[0]?.[1] ?? "";
      const cssValue = formatVariableValue(v.resolvedType, defaultValue as string);
      lines.push(`  --${toKebab(v.name)}: ${cssValue};`);
    }
    lines.push("");
  }

  // Group styles by type
  const paintStyles = styles.filter((s) => s.styleType === "PAINT");
  const textStyles = styles.filter((s) => s.styleType === "TEXT");
  const effectStyles = styles.filter((s) => s.styleType === "EFFECT");

  if (paintStyles.length > 0) {
    lines.push("  /* === PaintStyles === */");
    for (const s of paintStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      if (s.paints) {
        try {
          const paints = JSON.parse(s.paints);
          const first = paints[0];
          if (first?.type === "SOLID" && first.color) {
            lines.push(`  --paint-${toKebab(s.name)}: ${rgbaToHex(first.color)};`);
          }
        } catch {
          lines.push(`  /* --paint-${toKebab(s.name)}: complex paint */`);
        }
      }
    }
    lines.push("");
  }

  if (textStyles.length > 0) {
    lines.push("  /* === TextStyles === */");
    for (const s of textStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      const prefix = `--text-${toKebab(s.name)}`;
      if (s.fontSize) lines.push(`  ${prefix}-size: ${s.fontSize}px;`);
      if (s.fontFamily) lines.push(`  ${prefix}-family: "${s.fontFamily}";`);
      if (s.fontWeight) lines.push(`  ${prefix}-weight: ${s.fontWeight};`);
      if (s.lineHeight) {
        try {
          const lh = JSON.parse(s.lineHeight);
          if (lh.unit === "PIXELS") lines.push(`  ${prefix}-line-height: ${lh.value}px;`);
          else if (lh.unit === "PERCENT") lines.push(`  ${prefix}-line-height: ${lh.value}%;`);
          else lines.push(`  ${prefix}-line-height: normal;`);
        } catch {
          lines.push(`  ${prefix}-line-height: normal;`);
        }
      }
    }
    lines.push("");
  }

  if (effectStyles.length > 0) {
    lines.push("  /* === EffectStyles === */");
    for (const s of effectStyles.sort((a, b) => a.name.localeCompare(b.name))) {
      if (s.effects) {
        try {
          const effects = JSON.parse(s.effects);
          const shadow = effects[0];
          if (shadow?.type === "DROP_SHADOW") {
            const { offset, radius, color } = shadow;
            const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
            lines.push(`  --shadow-${toKebab(s.name)}: ${offset.x}px ${offset.y}px ${radius}px ${rgba};`);
          } else if (shadow?.type === "LAYER_BLUR" || shadow?.type === "BACKGROUND_BLUR") {
            lines.push(`  --blur-${toKebab(s.name)}: ${shadow.radius}px;`);
          }
        } catch {
          lines.push(`  /* --effect-${toKebab(s.name)}: complex effect */`);
        }
      }
    }
    lines.push("");
  }

  lines.push("}");
  return lines.join("\n");
}
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/sandbox/cssGenerator.ts
git commit -m "feat: add CSS token file generator"
```

---

### Task 6: Add controller handlers for tokens

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/controller.ts`

**Step 1: Import token functions and add handlers**

Add imports at the top:
```typescript
import {
  scanVariables,
  scanStyles,
  getVariablesMapping,
  getStylesMapping,
  linkVariables,
  linkStyles,
  unlinkVariables,
  unlinkStyles,
  updateVariablesHash,
  updateStylesHash,
  updateVariablesCodeHash,
  updateStylesCodeHash,
} from "./tokenMapping";
import { generateCSS } from "./cssGenerator";
```

Add handlers after existing ones (after line 83):
```typescript
onRequestFromUI("SCAN_VARIABLES", async () => {
  const rawVars = await scanVariables();
  return {
    variables: rawVars.map((v) => ({
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      collectionName: v.collectionName,
    })),
  };
});

onRequestFromUI("SCAN_STYLES", async () => {
  const rawStyles = await scanStyles();
  return {
    styles: rawStyles.map((s) => ({
      id: s.id,
      name: s.name,
      styleType: s.styleType,
    })),
  };
});

onRequestFromUI("GET_VARIABLES_MAPPING", async () => {
  return await getVariablesMapping();
});

onRequestFromUI("GET_STYLES_MAPPING", async () => {
  return await getStylesMapping();
});

onRequestFromUI("LINK_VARIABLES", async ({ tokenFile }) => {
  return { success: await linkVariables(tokenFile) };
});

onRequestFromUI("LINK_STYLES", async ({ tokenFile }) => {
  return { success: await linkStyles(tokenFile) };
});

onRequestFromUI("UNLINK_VARIABLES", async () => {
  return { success: unlinkVariables() };
});

onRequestFromUI("UNLINK_STYLES", async () => {
  return { success: unlinkStyles() };
});

onRequestFromUI("UPDATE_VARIABLES_HASH", async () => {
  const hash = await updateVariablesHash();
  return { hash };
});

onRequestFromUI("UPDATE_STYLES_HASH", async () => {
  const hash = await updateStylesHash();
  return { hash };
});

onRequestFromUI("UPDATE_VARIABLES_CODE_HASH", async ({ codeHash }) => {
  return { success: updateVariablesCodeHash(codeHash) };
});

onRequestFromUI("UPDATE_STYLES_CODE_HASH", async ({ codeHash }) => {
  return { success: updateStylesCodeHash(codeHash) };
});

onRequestFromUI("GENERATE_CSS", async () => {
  const [variables, styles] = await Promise.all([scanVariables(), scanStyles()]);
  return { css: generateCSS(variables, styles) };
});
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/sandbox/controller.ts
git commit -m "feat: add controller handlers for token scanning and sync"
```

---

### Task 7: Add `kind` to existing component mapping

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/mapping.ts:68`

**Step 1: Add `kind: "component"` to linkComponent**

In `linkComponent()`, add `kind: "component"` to the entry object (line 68):
```typescript
  const entry: MappingEntry = {
    kind: "component",      // ADD THIS LINE
    nodeId,
    linkedFile: codePath,
    // ... rest unchanged
  };
```

**Step 2: Handle existing entries without `kind` in getAllMappings**

In `getAllMappings()`, after `const entry = getNodeMapping(node)` (line 117), add:
```typescript
    if (!entry.kind) entry.kind = "component";
```

**Step 3: Commit**
```bash
git add figma-sync-plugin/src/sandbox/mapping.ts
git commit -m "feat: add kind field to component mappings with backward compat"
```

---

### Task 8: Extend useSync hook for token cards

**Files:**
- Modify: `figma-sync-plugin/src/ui/hooks/useSync.ts`

**Step 1: Add token mapping fetching to refresh**

After the component mappings are built (after line 96), add token mapping logic:

```typescript
      // --- Token mappings (Variables & Styles) ---
      if (config.tokenFile) {
        const [varsResult, stylesResult] = await Promise.all([
          requestToPlugin("GET_VARIABLES_MAPPING"),
          requestToPlugin("GET_STYLES_MAPPING"),
        ]);

        // Token file SHA (shared by both)
        let tokenSha = "";
        let tokenFetchFailed = false;
        try {
          const { shas: tokenShas, errors: tokenErrors } = await getFileShas(
            config.repoOwner, config.repoName, [config.tokenFile], config.branch
          );
          tokenSha = tokenShas.get(config.tokenFile) ?? "";
          tokenFetchFailed = tokenErrors.has(config.tokenFile);
        } catch {
          tokenFetchFailed = true;
        }

        // Auto-link if not yet linked
        if (!varsResult.mapping) {
          await requestToPlugin("LINK_VARIABLES", { tokenFile: config.tokenFile });
          const fresh = await requestToPlugin("GET_VARIABLES_MAPPING");
          varsResult.mapping = fresh.mapping;
          varsResult.currentSnapshot = fresh.currentSnapshot;
        }
        if (!stylesResult.mapping) {
          await requestToPlugin("LINK_STYLES", { tokenFile: config.tokenFile });
          const fresh = await requestToPlugin("GET_STYLES_MAPPING");
          stylesResult.mapping = fresh.mapping;
          stylesResult.currentSnapshot = fresh.currentSnapshot;
        }

        // Initialize code hash on first run
        if (varsResult.mapping && varsResult.mapping.codeHash === "" && tokenSha) {
          varsResult.mapping.codeHash = tokenSha;
          requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: tokenSha });
        }
        if (stylesResult.mapping && stylesResult.mapping.codeHash === "" && tokenSha) {
          stylesResult.mapping.codeHash = tokenSha;
          requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: tokenSha });
        }

        if (varsResult.mapping) {
          withState.push({
            ...varsResult.mapping,
            currentCodeHash: tokenSha,
            currentSnapshot: undefined,
            tokenSnapshot: varsResult.currentSnapshot ?? undefined,
            state: computeState(varsResult.mapping, tokenSha, tokenFetchFailed),
          });
        }

        if (stylesResult.mapping) {
          withState.push({
            ...stylesResult.mapping,
            currentCodeHash: tokenSha,
            currentSnapshot: undefined,
            tokenSnapshot: stylesResult.currentSnapshot ?? undefined,
            state: computeState(stylesResult.mapping, tokenSha, tokenFetchFailed),
          });
        }
      }
```

Update the `MappingWithState` interface to include `tokenSnapshot`:
```typescript
export interface MappingWithState extends MappingEntry {
  state: SyncState;
  currentCodeHash: string;
  currentSnapshot?: FlatSnapshot;
  tokenSnapshot?: TokenSnapshot;
}
```

Add import for `TokenSnapshot` at line 2.

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/ui/hooks/useSync.ts
git commit -m "feat: extend useSync to fetch and display token mappings"
```

---

### Task 9: Extend useSyncActions for token sync

**Files:**
- Modify: `figma-sync-plugin/src/ui/hooks/useSyncActions.ts`

**Step 1: Add token-aware sync handlers**

Update `handleForceSyncFigma` and `handleForceSyncCode` to dispatch different messages based on `kind`:

```typescript
  const handleForceSyncFigma = useCallback(async (mapping: MappingWithState) => {
    const id = mapping.nodeId;
    setSyncingId(id);
    try {
      if (mapping.kind === "variable") {
        await requestToPlugin("UPDATE_VARIABLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else if (mapping.kind === "style") {
        await requestToPlugin("UPDATE_STYLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else {
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: id });
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_CODE_HASH", { nodeId: id, codeHash: mapping.currentCodeHash });
        }
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  const handleForceSyncCode = useCallback(async (mapping: MappingWithState) => {
    const id = mapping.nodeId;
    setSyncingId(id);
    try {
      if (mapping.kind === "variable") {
        await requestToPlugin("UPDATE_VARIABLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_VARIABLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else if (mapping.kind === "style") {
        await requestToPlugin("UPDATE_STYLES_HASH");
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_STYLES_CODE_HASH", { codeHash: mapping.currentCodeHash });
        }
      } else {
        await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: id });
        if (mapping.currentCodeHash) {
          await requestToPlugin("UPDATE_CODE_HASH", { nodeId: id, codeHash: mapping.currentCodeHash });
        }
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync");
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/ui/hooks/useSyncActions.ts
git commit -m "feat: extend sync actions to handle token mappings"
```

---

### Task 10: Add tokenFile to SettingsView

**Files:**
- Modify: `figma-sync-plugin/src/ui/pages/SettingsView.tsx`

**Step 1: Add tokenFile input**

Add state (after line 22):
```typescript
  const [tokenFile, setTokenFile] = useState(config?.tokenFile ?? "src/styles/tokens.css");
```

Add `tokenFile` to the config in `handleSave()`:
```typescript
    const newConfig: GlobalConfig = {
      repoOwner: match[1],
      repoName: match[2].replace(/\.git$/, ""),
      branch,
      basePath,
      framework,
      styling,
      tokenFile,
    };
```

Add input field after the basePath label (after line 96):
```tsx
      <label className="block mb-3">
        <span className="block text-xs font-medium text-gray-700 mb-1">Token File</span>
        <input
          type="text"
          value={tokenFile}
          onChange={(e) => setTokenFile(e.target.value)}
          placeholder="src/styles/tokens.css"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="block text-xs text-gray-400 mt-1">CSS file for design tokens (variables & styles)</span>
      </label>
```

**Step 2: Commit**
```bash
git add figma-sync-plugin/src/ui/pages/SettingsView.tsx
git commit -m "feat: add tokenFile setting to SettingsView"
```

---

### Task 11: Update MainView and ComponentCard for token entries

**Files:**
- Modify: `figma-sync-plugin/src/ui/pages/MainView.tsx`
- Modify: `figma-sync-plugin/src/ui/components/ComponentCard.tsx`

**Step 1: Pass `kind` through to ComponentCard**

In `ComponentCard.tsx`, add `kind` to props and display a small label for token entries:
```typescript
interface ComponentCardProps {
  kind: "component" | "style" | "variable";
  componentName: string;
  // ... rest unchanged
}
```

In the component name display area, optionally show the kind if it's a token:
```tsx
<div className="font-semibold text-sm mb-1">
  {kind !== "component" && (
    <span className="text-[10px] font-normal text-gray-400 uppercase tracking-wide mr-1">
      {kind === "variable" ? "VAR" : "STY"}
    </span>
  )}
  {componentName}
</div>
```

**Step 2: Pass `kind` from MainView**

In `MainView.tsx`, pass `kind` to ComponentCard (line 72):
```tsx
<ComponentCard
  key={m.nodeId}
  kind={m.kind ?? "component"}
  componentName={m.componentName}
  // ... rest unchanged
/>
```

**Step 3: Commit**
```bash
git add figma-sync-plugin/src/ui/pages/MainView.tsx figma-sync-plugin/src/ui/components/ComponentCard.tsx
git commit -m "feat: display token entries as cards in MainView"
```

---

### Task 12: Build and verify

**Step 1: Run the build**

Run: `cd figma-sync-plugin && npm run build`
Expected: No TypeScript errors, successful build

**Step 2: Fix any type errors**

Address any compilation issues from the type changes.

**Step 3: Commit any fixes**
```bash
git commit -am "fix: resolve build errors from token tracking integration"
```
