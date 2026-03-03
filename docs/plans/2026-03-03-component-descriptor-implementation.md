# Component Descriptor JSON — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat-layer component sync with a JSON descriptor system that creates proper Figma components with properties, variants, and instance relationships via Plugin API.

**Architecture:** Claude Code generates Component Descriptor JSON from code → commits to `.figma/components/<Name>.json` in GitHub → Plugin reads JSON and builds proper Figma components via Plugin API. Reverse direction: Plugin extracts Figma components to same JSON format → commits to GitHub → Claude Code reads and generates code.

**Tech Stack:** TypeScript, Figma Plugin API, React (UI layer), GitHub REST API, esbuild (sandbox), Vite (UI)

**Verification:** `npm run typecheck` (both sandbox + UI) and `npm run build` after each task. No test framework is set up — verification is typecheck + build + manual Figma testing.

---

### Task 1: Define ComponentDescriptor Types

**Files:**
- Modify: `figma-sync-plugin/src/shared/types.ts` (append after line 81)

**Step 1: Add type definitions**

```typescript
// --- Component Descriptor JSON Schema ---

export interface ComponentDescriptorFill {
  type: "SOLID";
  color: string; // hex e.g. "#3B82F6"
  opacity?: number; // 0-1, default 1
  boundVariable?: string; // Figma variable name e.g. "color/brand/primary"
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
  color?: string; // hex with alpha for shadows
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
  options?: string[]; // for VARIANT type
  default: string | boolean | null;
}

export interface ComponentDescriptorChild {
  type: "FRAME" | "TEXT" | "INSTANCE" | "RECTANGLE" | "ELLIPSE" | "VECTOR";
  name: string;
  bindTo?: string; // links to a component property name
  componentRef?: string; // for INSTANCE type — references another component by name
  layout?: ComponentDescriptorLayout;
  styles?: ComponentDescriptorStyles;
  textStyles?: ComponentDescriptorTextStyles; // for TEXT type
  textContent?: string; // for TEXT type — default text
  children?: ComponentDescriptorChild[];
}

export interface ComponentDescriptorVariantOverride {
  props: Record<string, string>; // variant property values e.g. { variant: "secondary", size: "md" }
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
  $schema: string; // "figma-component-descriptor/v1"
  name: string;
  description?: string;
  properties?: ComponentDescriptorProperty[];
  layout?: ComponentDescriptorLayout;
  styles?: ComponentDescriptorStyles;
  children?: ComponentDescriptorChild[];
  variants?: ComponentDescriptorVariantOverride[];
}
```

**Step 2: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add figma-sync-plugin/src/shared/types.ts
git commit -m "feat: add ComponentDescriptor type definitions"
```

---

### Task 2: Add New Message Types

**Files:**
- Modify: `figma-sync-plugin/src/shared/messages.ts`

**Step 1: Add message types to PluginRequest union**

Add these two entries to the `PluginRequest` union type (after the existing `APPLY_STYLE_VALUES` entry):

```typescript
| { type: "APPLY_COMPONENT_JSON"; nodeId: string; json: ComponentDescriptor }
| { type: "EXTRACT_COMPONENT_JSON"; nodeId: string }
```

**Step 2: Add response types to ResponseMap**

Add to the `ResponseMap` interface:

```typescript
APPLY_COMPONENT_JSON: { success: boolean; nodeId: string };
EXTRACT_COMPONENT_JSON: { json: ComponentDescriptor };
```

**Step 3: Add import**

Add `ComponentDescriptor` to the import from `./types`:

```typescript
import type { MappingEntry, SyncStatus, GlobalConfig, FlatSnapshot, TokenSnapshot, ComponentDescriptor } from "./types";
```

**Step 4: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add figma-sync-plugin/src/shared/messages.ts
git commit -m "feat: add APPLY_COMPONENT_JSON and EXTRACT_COMPONENT_JSON message types"
```

---

### Task 3: Implement componentExtractor.ts (Figma → JSON)

Extracting from Figma is simpler than building — start here so we can test the round-trip later.

**Files:**
- Create: `figma-sync-plugin/src/sandbox/componentExtractor.ts`

**Step 1: Write the extractor**

```typescript
import type {
  ComponentDescriptor,
  ComponentDescriptorChild,
  ComponentDescriptorFill,
  ComponentDescriptorStroke,
  ComponentDescriptorEffect,
  ComponentDescriptorLayout,
  ComponentDescriptorStyles,
  ComponentDescriptorTextStyles,
  ComponentDescriptorProperty,
  ComponentDescriptorVariantOverride,
} from "../shared/types";

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractFills(node: GeometryMixin): ComponentDescriptorFill[] | undefined {
  const fills = node.fills;
  if (!fills || fills === figma.mixed || !Array.isArray(fills) || fills.length === 0) return undefined;
  return fills
    .filter((f): f is SolidPaint => f.type === "SOLID" && f.visible !== false)
    .map((f) => {
      const fill: ComponentDescriptorFill = {
        type: "SOLID",
        color: rgbToHex(f.color.r, f.color.g, f.color.b),
      };
      if (f.opacity !== undefined && f.opacity !== 1) fill.opacity = f.opacity;
      // Check for bound variable
      const bindings = (node as SceneNode).boundVariables;
      if (bindings && "fills" in bindings) {
        const fillBindings = bindings.fills;
        if (Array.isArray(fillBindings) && fillBindings.length > 0) {
          const binding = fillBindings[0];
          if (binding) {
            const variable = figma.variables.getVariableById(binding.id);
            if (variable) fill.boundVariable = variable.name;
          }
        }
      }
      return fill;
    });
}

function extractStrokes(node: GeometryMixin & MinimalStrokesMixin): ComponentDescriptorStroke[] | undefined {
  const strokes = node.strokes;
  if (!strokes || !Array.isArray(strokes) || strokes.length === 0) return undefined;
  return strokes
    .filter((s): s is SolidPaint => s.type === "SOLID" && s.visible !== false)
    .map((s) => {
      const stroke: ComponentDescriptorStroke = {
        type: "SOLID",
        color: rgbToHex(s.color.r, s.color.g, s.color.b),
      };
      if (s.opacity !== undefined && s.opacity !== 1) stroke.opacity = s.opacity;
      if ("strokeWeight" in node && typeof node.strokeWeight === "number") {
        stroke.weight = node.strokeWeight;
      }
      return stroke;
    });
}

function extractEffects(node: BlendMixin): ComponentDescriptorEffect[] | undefined {
  const effects = node.effects;
  if (!effects || effects.length === 0) return undefined;
  return effects
    .filter((e) => e.visible !== false)
    .map((e) => {
      const effect: ComponentDescriptorEffect = {
        type: e.type as ComponentDescriptorEffect["type"],
        radius: e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR" ? e.radius : (e as DropShadowEffect).radius,
      };
      if ("color" in e && e.color) {
        const c = e.color;
        effect.color = rgbToHex(c.r, c.g, c.b);
        if (c.a !== undefined && c.a !== 1) effect.color += Math.round(c.a * 255).toString(16).padStart(2, "0");
      }
      if ("offset" in e && e.offset) effect.offset = { x: e.offset.x, y: e.offset.y };
      if ("spread" in e && e.spread) effect.spread = e.spread;
      return effect;
    });
}

function extractLayout(node: FrameNode | ComponentNode | ComponentSetNode): ComponentDescriptorLayout | undefined {
  if (node.layoutMode === "NONE") return undefined;
  const layout: ComponentDescriptorLayout = {
    mode: node.layoutMode as "HORIZONTAL" | "VERTICAL",
  };
  const p = {
    top: node.paddingTop,
    right: node.paddingRight,
    bottom: node.paddingBottom,
    left: node.paddingLeft,
  };
  if (p.top || p.right || p.bottom || p.left) layout.padding = p;
  if (node.itemSpacing) layout.itemSpacing = node.itemSpacing;
  if (node.primaryAxisAlignItems !== "MIN") layout.primaryAxisAlign = node.primaryAxisAlignItems;
  if (node.counterAxisAlignItems !== "MIN") layout.counterAxisAlign = node.counterAxisAlignItems;
  if (node.primaryAxisSizingMode !== "FIXED") layout.primaryAxisSizing = node.primaryAxisSizingMode === "AUTO" ? "AUTO" : "FIXED";
  if (node.counterAxisSizingMode !== "FIXED") layout.counterAxisSizing = node.counterAxisSizingMode === "AUTO" ? "AUTO" : "FIXED";
  return layout;
}

function extractStyles(node: SceneNode): ComponentDescriptorStyles | undefined {
  const styles: ComponentDescriptorStyles = {};
  if ("fills" in node) styles.fills = extractFills(node as GeometryMixin);
  if ("strokes" in node) styles.strokes = extractStrokes(node as GeometryMixin & MinimalStrokesMixin);
  if ("effects" in node) styles.effects = extractEffects(node as BlendMixin);
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr !== undefined && cr !== 0) {
      if (cr === figma.mixed) {
        const rn = node as RectangleNode;
        styles.cornerRadius = {
          topLeft: rn.topLeftRadius,
          topRight: rn.topRightRadius,
          bottomLeft: rn.bottomLeftRadius,
          bottomRight: rn.bottomRightRadius,
        };
      } else {
        styles.cornerRadius = cr;
      }
    }
  }
  if (node.width) styles.width = node.width;
  if (node.height) styles.height = node.height;

  return Object.keys(styles).length > 0 ? styles : undefined;
}

function extractTextStyles(node: TextNode): ComponentDescriptorTextStyles | undefined {
  const ts: ComponentDescriptorTextStyles = {};
  if (node.fontSize !== figma.mixed) ts.fontSize = node.fontSize as number;
  if (node.fontName !== figma.mixed) {
    ts.fontFamily = (node.fontName as FontName).family;
    const style = (node.fontName as FontName).style;
    // Map common style names to weight numbers
    const weightMap: Record<string, number> = {
      Thin: 100, ExtraLight: 200, Light: 300, Regular: 400,
      Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900,
    };
    ts.fontWeight = weightMap[style] ?? 400;
  }
  if (node.lineHeight !== figma.mixed) {
    const lh = node.lineHeight as LineHeight;
    if (lh.unit === "AUTO") {
      ts.lineHeight = { value: 0, unit: "AUTO" };
    } else {
      ts.lineHeight = { value: lh.value, unit: lh.unit };
    }
  }
  if (node.letterSpacing !== figma.mixed) {
    const ls = node.letterSpacing as LetterSpacing;
    if (ls.value !== 0) ts.letterSpacing = ls.value;
  }
  if (node.textAlignHorizontal !== "LEFT") {
    ts.textAlignHorizontal = node.textAlignHorizontal;
  }
  ts.fills = extractFills(node);
  return Object.keys(ts).length > 0 ? ts : undefined;
}

function extractChild(node: SceneNode): ComponentDescriptorChild | null {
  if (node.type === "TEXT") {
    const child: ComponentDescriptorChild = {
      type: "TEXT",
      name: node.name,
      textStyles: extractTextStyles(node),
      textContent: node.characters,
    };
    child.styles = extractStyles(node);
    return child;
  }

  if (node.type === "INSTANCE") {
    const child: ComponentDescriptorChild = {
      type: "INSTANCE",
      name: node.name,
    };
    const mainComp = node.mainComponent;
    if (mainComp) {
      const parent = mainComp.parent;
      child.componentRef = parent && parent.type === "COMPONENT_SET" ? parent.name : mainComp.name;
    }
    child.styles = extractStyles(node);
    return child;
  }

  if (node.type === "FRAME" || node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR") {
    const child: ComponentDescriptorChild = {
      type: node.type as ComponentDescriptorChild["type"],
      name: node.name,
      styles: extractStyles(node),
    };
    if (node.type === "FRAME") {
      child.layout = extractLayout(node);
      if ("children" in node && node.children.length > 0) {
        child.children = node.children.map(extractChild).filter((c): c is ComponentDescriptorChild => c !== null);
      }
    }
    return child;
  }

  return null;
}

function extractProperties(node: ComponentNode | ComponentSetNode): ComponentDescriptorProperty[] | undefined {
  const defs = node.componentPropertyDefinitions;
  if (!defs || Object.keys(defs).length === 0) return undefined;

  return Object.entries(defs).map(([key, def]) => {
    const prop: ComponentDescriptorProperty = {
      name: key.includes("#") ? key.split("#")[0] : key,
      type: def.type as ComponentDescriptorProperty["type"],
      default: def.defaultValue as string | boolean | null,
    };
    if (def.type === "VARIANT" && def.variantOptions) {
      prop.options = def.variantOptions;
    }
    return prop;
  });
}

function extractVariants(componentSet: ComponentSetNode): ComponentDescriptorVariantOverride[] | undefined {
  if (componentSet.children.length <= 1) return undefined;

  // Use first child as base variant — extract overrides for the rest
  const baseChild = componentSet.children[0] as ComponentNode;
  const baseStyles = extractStyles(baseChild);
  const baseFillsJson = JSON.stringify(baseStyles?.fills);

  const variants: ComponentDescriptorVariantOverride[] = [];

  for (let i = 1; i < componentSet.children.length; i++) {
    const variant = componentSet.children[i] as ComponentNode;
    // Parse variant name like "variant=secondary, size=md"
    const props: Record<string, string> = {};
    variant.name.split(",").forEach((pair) => {
      const [k, v] = pair.split("=").map((s) => s.trim());
      if (k && v) props[k] = v;
    });

    const variantStyles = extractStyles(variant);
    const overrides: ComponentDescriptorVariantOverride["overrides"] = {};

    // Diff styles
    if (JSON.stringify(variantStyles?.fills) !== baseFillsJson) {
      overrides.styles = { fills: variantStyles?.fills };
    }

    // Diff children
    if ("children" in variant && "children" in baseChild) {
      const childOverrides: Record<string, { styles?: Partial<ComponentDescriptorStyles>; textStyles?: Partial<ComponentDescriptorTextStyles>; textContent?: string }> = {};
      for (const vc of variant.children) {
        const bc = baseChild.children.find((c) => c.name === vc.name);
        if (!bc) continue;
        if (vc.type === "TEXT" && bc.type === "TEXT") {
          const vts = extractTextStyles(vc);
          const bts = extractTextStyles(bc);
          if (JSON.stringify(vts) !== JSON.stringify(bts)) {
            childOverrides[vc.name] = { textStyles: vts };
          }
          if (vc.characters !== bc.characters) {
            childOverrides[vc.name] = { ...childOverrides[vc.name], textContent: vc.characters };
          }
        }
        const vs = extractStyles(vc);
        const bs = extractStyles(bc);
        if (JSON.stringify(vs) !== JSON.stringify(bs)) {
          childOverrides[vc.name] = { ...childOverrides[vc.name], styles: vs };
        }
      }
      if (Object.keys(childOverrides).length > 0) overrides.children = childOverrides;
    }

    if (Object.keys(overrides).length > 0) {
      variants.push({ props, overrides });
    }
  }

  return variants.length > 0 ? variants : undefined;
}

export async function extractComponentJSON(nodeId: string): Promise<ComponentDescriptor> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);

  if (node.type === "COMPONENT_SET") {
    const baseChild = node.children[0] as ComponentNode;
    const descriptor: ComponentDescriptor = {
      $schema: "figma-component-descriptor/v1",
      name: node.name,
      description: node.description || undefined,
      properties: extractProperties(node),
      layout: extractLayout(baseChild),
      styles: extractStyles(baseChild),
      children: baseChild.children.map(extractChild).filter((c): c is ComponentDescriptorChild => c !== null),
      variants: extractVariants(node),
    };
    return descriptor;
  }

  if (node.type === "COMPONENT") {
    const descriptor: ComponentDescriptor = {
      $schema: "figma-component-descriptor/v1",
      name: node.name,
      description: node.description || undefined,
      properties: extractProperties(node),
      layout: extractLayout(node),
      styles: extractStyles(node),
      children: node.children.map(extractChild).filter((c): c is ComponentDescriptorChild => c !== null),
    };
    return descriptor;
  }

  throw new Error(`Node ${nodeId} is not a component (type: ${node.type})`);
}
```

**Step 2: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add figma-sync-plugin/src/sandbox/componentExtractor.ts
git commit -m "feat: add componentExtractor — Figma node to JSON extraction"
```

---

### Task 4: Implement componentBuilder.ts (JSON → Figma)

**Files:**
- Create: `figma-sync-plugin/src/sandbox/componentBuilder.ts`

**Step 1: Write the builder**

```typescript
import type {
  ComponentDescriptor,
  ComponentDescriptorChild,
  ComponentDescriptorFill,
  ComponentDescriptorStroke,
  ComponentDescriptorEffect,
  ComponentDescriptorLayout,
  ComponentDescriptorStyles,
  ComponentDescriptorTextStyles,
  ComponentDescriptorVariantOverride,
} from "../shared/types";

function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  const clean = hex.replace("#", "");
  let r: number, g: number, b: number, a = 1;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
  } else if (clean.length === 8) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
    a = parseInt(clean.slice(6, 8), 16) / 255;
  } else {
    r = 0; g = 0; b = 0;
  }
  return { r, g, b, a };
}

function applyFills(node: GeometryMixin & SceneNode, fills: ComponentDescriptorFill[]): void {
  const paints: SolidPaint[] = fills.map((f) => {
    const { r, g, b } = hexToRgb(f.color);
    return {
      type: "SOLID",
      color: { r, g, b },
      opacity: f.opacity ?? 1,
      visible: true,
    };
  });
  node.fills = paints;

  // Bind variables if specified
  for (let i = 0; i < fills.length; i++) {
    const fill = fills[i];
    if (fill.boundVariable) {
      const variables = figma.variables.getLocalVariables("COLOR");
      const variable = variables.find((v) => v.name === fill.boundVariable);
      if (variable) {
        node.setBoundVariable("fills", i, variable);
      }
    }
  }
}

function applyStrokes(node: GeometryMixin & MinimalStrokesMixin, strokes: ComponentDescriptorStroke[]): void {
  const paints: SolidPaint[] = strokes.map((s) => {
    const { r, g, b } = hexToRgb(s.color);
    return { type: "SOLID", color: { r, g, b }, opacity: s.opacity ?? 1, visible: true };
  });
  node.strokes = paints;
  if (strokes[0]?.weight !== undefined) {
    node.strokeWeight = strokes[0].weight;
  }
}

function applyEffects(node: BlendMixin, effects: ComponentDescriptorEffect[]): void {
  node.effects = effects.map((e) => {
    if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
      return { type: e.type, radius: e.radius, visible: e.visible ?? true } as BlurEffect;
    }
    const { r, g, b, a } = e.color ? hexToRgb(e.color) : { r: 0, g: 0, b: 0, a: 0.25 };
    return {
      type: e.type,
      color: { r, g, b, a },
      offset: e.offset ?? { x: 0, y: 0 },
      radius: e.radius,
      spread: e.spread ?? 0,
      visible: e.visible ?? true,
    } as DropShadowEffect;
  });
}

function applyCornerRadius(node: SceneNode, cr: ComponentDescriptorStyles["cornerRadius"]): void {
  if (cr === undefined) return;
  if (typeof cr === "number") {
    (node as RectangleNode).cornerRadius = cr;
  } else {
    const rn = node as RectangleNode;
    rn.topLeftRadius = cr.topLeft;
    rn.topRightRadius = cr.topRight;
    rn.bottomLeftRadius = cr.bottomLeft;
    rn.bottomRightRadius = cr.bottomRight;
  }
}

function applyLayout(node: FrameNode | ComponentNode, layout: ComponentDescriptorLayout): void {
  node.layoutMode = layout.mode === "NONE" ? "NONE" : layout.mode;
  if (layout.padding) {
    node.paddingTop = layout.padding.top;
    node.paddingRight = layout.padding.right;
    node.paddingBottom = layout.padding.bottom;
    node.paddingLeft = layout.padding.left;
  }
  if (layout.itemSpacing !== undefined) node.itemSpacing = layout.itemSpacing;
  if (layout.primaryAxisAlign) node.primaryAxisAlignItems = layout.primaryAxisAlign;
  if (layout.counterAxisAlign) node.counterAxisAlignItems = layout.counterAxisAlign;
  if (layout.primaryAxisSizing) node.primaryAxisSizingMode = layout.primaryAxisSizing;
  if (layout.counterAxisSizing) node.counterAxisSizingMode = layout.counterAxisSizing;
}

function applyStyles(node: SceneNode, styles: ComponentDescriptorStyles): void {
  if (styles.fills && "fills" in node) applyFills(node as GeometryMixin & SceneNode, styles.fills);
  if (styles.strokes && "strokes" in node) applyStrokes(node as GeometryMixin & MinimalStrokesMixin, styles.strokes);
  if (styles.effects && "effects" in node) applyEffects(node as BlendMixin, styles.effects);
  if (styles.cornerRadius !== undefined) applyCornerRadius(node, styles.cornerRadius);
  if (styles.width !== undefined) node.resize(styles.width, styles.height ?? node.height);
  if (styles.height !== undefined) node.resize(styles.width ?? node.width, styles.height);
}

async function applyTextStyles(node: TextNode, textStyles: ComponentDescriptorTextStyles): Promise<void> {
  const family = textStyles.fontFamily ?? "Inter";
  const weight = textStyles.fontWeight ?? 400;
  const weightStyleMap: Record<number, string> = {
    100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular",
    500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black",
  };
  const style = weightStyleMap[weight] ?? "Regular";
  await figma.loadFontAsync({ family, style });
  node.fontName = { family, style };

  if (textStyles.fontSize) node.fontSize = textStyles.fontSize;
  if (textStyles.lineHeight) {
    if (typeof textStyles.lineHeight === "number") {
      node.lineHeight = { value: textStyles.lineHeight, unit: "PIXELS" };
    } else if (textStyles.lineHeight.unit === "AUTO") {
      node.lineHeight = { unit: "AUTO" };
    } else {
      node.lineHeight = { value: textStyles.lineHeight.value, unit: textStyles.lineHeight.unit };
    }
  }
  if (textStyles.letterSpacing !== undefined) {
    node.letterSpacing = { value: textStyles.letterSpacing, unit: "PIXELS" };
  }
  if (textStyles.textAlignHorizontal) node.textAlignHorizontal = textStyles.textAlignHorizontal;
  if (textStyles.fills) applyFills(node, textStyles.fills);
}

async function buildChild(child: ComponentDescriptorChild, parent: FrameNode | ComponentNode): Promise<SceneNode> {
  if (child.type === "TEXT") {
    const textNode = figma.createText();
    textNode.name = child.name;
    await figma.loadFontAsync({ family: "Inter", style: "Regular" }); // default font
    if (child.textContent) textNode.characters = child.textContent;
    if (child.textStyles) await applyTextStyles(textNode, child.textStyles);
    if (child.styles) applyStyles(textNode, child.styles);
    parent.appendChild(textNode);
    return textNode;
  }

  if (child.type === "INSTANCE" && child.componentRef) {
    // Find the referenced component by name
    const allComponents = figma.root.findAll((n) => n.type === "COMPONENT" || n.type === "COMPONENT_SET");
    const target = allComponents.find((n) => n.name === child.componentRef);
    if (target) {
      const mainComp = target.type === "COMPONENT_SET" ? target.defaultVariant : target;
      const instance = (mainComp as ComponentNode).createInstance();
      instance.name = child.name;
      if (child.styles) applyStyles(instance, child.styles);
      parent.appendChild(instance);
      return instance;
    }
    // Fallback: create a frame placeholder
    const frame = figma.createFrame();
    frame.name = `${child.name} (missing: ${child.componentRef})`;
    if (child.styles) applyStyles(frame, child.styles);
    parent.appendChild(frame);
    return frame;
  }

  if (child.type === "FRAME") {
    const frame = figma.createFrame();
    frame.name = child.name;
    if (child.layout) applyLayout(frame, child.layout);
    if (child.styles) applyStyles(frame, child.styles);
    if (child.children) {
      for (const grandchild of child.children) {
        await buildChild(grandchild, frame);
      }
    }
    parent.appendChild(frame);
    return frame;
  }

  // RECTANGLE, ELLIPSE, etc.
  let node: SceneNode;
  if (child.type === "ELLIPSE") {
    node = figma.createEllipse();
  } else {
    node = figma.createRectangle();
  }
  node.name = child.name;
  if (child.styles) applyStyles(node, child.styles);
  parent.appendChild(node);
  return node;
}

async function buildVariantComponent(
  json: ComponentDescriptor,
  variantOverride: ComponentDescriptorVariantOverride | null,
  parent: ComponentSetNode
): Promise<ComponentNode> {
  const comp = figma.createComponent();

  // Set variant name like "variant=primary, size=md"
  if (variantOverride) {
    comp.name = Object.entries(variantOverride.props).map(([k, v]) => `${k}=${v}`).join(", ");
  } else {
    // Base variant — use default property values
    const defaults = (json.properties ?? [])
      .filter((p) => p.type === "VARIANT")
      .map((p) => `${p.name}=${p.default}`)
      .join(", ");
    comp.name = defaults || json.name;
  }

  // Apply base layout + styles
  if (json.layout) applyLayout(comp, json.layout);
  const styles = variantOverride?.overrides.styles
    ? { ...json.styles, ...variantOverride.overrides.styles }
    : json.styles;
  if (styles) applyStyles(comp, styles);

  // Build children
  if (json.children) {
    for (const child of json.children) {
      const builtChild = await buildChild(child, comp);
      // Apply variant child overrides
      if (variantOverride?.overrides.children?.[child.name]) {
        const co = variantOverride.overrides.children[child.name];
        if (co.styles) applyStyles(builtChild, co.styles as ComponentDescriptorStyles);
        if (co.textStyles && builtChild.type === "TEXT") await applyTextStyles(builtChild, co.textStyles);
        if (co.textContent && builtChild.type === "TEXT") {
          await figma.loadFontAsync(builtChild.fontName as FontName);
          builtChild.characters = co.textContent;
        }
      }
    }
  }

  parent.appendChild(comp);
  return comp;
}

async function buildSingleComponent(json: ComponentDescriptor): Promise<ComponentNode> {
  const comp = figma.createComponent();
  comp.name = json.name;
  if (json.description) comp.description = json.description;

  if (json.layout) applyLayout(comp, json.layout);
  if (json.styles) applyStyles(comp, json.styles);

  // Add non-variant properties
  const nonVariantProps = (json.properties ?? []).filter((p) => p.type !== "VARIANT");
  for (const prop of nonVariantProps) {
    comp.addComponentProperty(prop.name, prop.type, prop.default as string);
  }

  // Build children
  if (json.children) {
    for (const child of json.children) {
      await buildChild(child, comp);
    }
  }

  return comp;
}

async function buildComponentSet(json: ComponentDescriptor): Promise<ComponentSetNode> {
  const variantProps = (json.properties ?? []).filter((p) => p.type === "VARIANT");

  // Build base variant (default values)
  const tempFrame = figma.createFrame();
  const baseComp = await buildVariantComponent(json, null, tempFrame as unknown as ComponentSetNode);

  // Build variant overrides
  const variantComps: ComponentNode[] = [baseComp];
  if (json.variants) {
    for (const vo of json.variants) {
      const vc = await buildVariantComponent(json, vo, tempFrame as unknown as ComponentSetNode);
      variantComps.push(vc);
    }
  }

  // Create ComponentSet from variant components
  const componentSet = figma.combineAsVariants(variantComps, figma.currentPage);
  componentSet.name = json.name;
  if (json.description) componentSet.description = json.description;

  // Add non-variant properties to the component set
  const nonVariantProps = (json.properties ?? []).filter((p) => p.type !== "VARIANT");
  for (const prop of nonVariantProps) {
    componentSet.addComponentProperty(prop.name, prop.type, prop.default as string);
  }

  // Clean up temp frame
  tempFrame.remove();

  return componentSet;
}

async function updateExistingNode(nodeId: string, json: ComponentDescriptor): Promise<SceneNode> {
  const existing = await figma.getNodeByIdAsync(nodeId);
  if (!existing) throw new Error(`Node ${nodeId} not found for update`);

  // Remove existing node and rebuild in same position
  const parent = existing.parent;
  const x = (existing as SceneNode).x;
  const y = (existing as SceneNode).y;
  const index = parent ? Array.from(parent.children).indexOf(existing as SceneNode) : -1;

  existing.remove();

  // Build new
  const hasVariants = (json.properties ?? []).some((p) => p.type === "VARIANT");
  const newNode = hasVariants ? await buildComponentSet(json) : await buildSingleComponent(json);

  // Restore position
  (newNode as SceneNode).x = x;
  (newNode as SceneNode).y = y;

  return newNode;
}

export async function applyComponentJSON(nodeId: string, json: ComponentDescriptor): Promise<string> {
  // If nodeId points to an existing node, update it
  const existing = await figma.getNodeByIdAsync(nodeId);
  if (existing) {
    const newNode = await updateExistingNode(nodeId, json);
    return newNode.id;
  }

  // Otherwise create new
  const hasVariants = (json.properties ?? []).some((p) => p.type === "VARIANT");
  const node = hasVariants ? await buildComponentSet(json) : await buildSingleComponent(json);

  // Position on current page
  const page = figma.currentPage;
  const lastNode = page.children[page.children.length - 1];
  if (lastNode && lastNode.id !== node.id) {
    (node as SceneNode).x = (lastNode as SceneNode).x + (lastNode as SceneNode).width + 100;
  }

  return node.id;
}
```

**Step 2: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add figma-sync-plugin/src/sandbox/componentBuilder.ts
git commit -m "feat: add componentBuilder — JSON to Figma Plugin API component creation"
```

---

### Task 5: Add Controller Handlers

**Files:**
- Modify: `figma-sync-plugin/src/sandbox/controller.ts`

**Step 1: Add imports**

At the top of controller.ts, add:

```typescript
import { extractComponentJSON } from "./componentExtractor";
import { applyComponentJSON } from "./componentBuilder";
```

**Step 2: Add EXTRACT_COMPONENT_JSON handler**

After the existing `APPLY_STYLE_VALUES` handler (around line 254), add:

```typescript
onRequestFromUI("EXTRACT_COMPONENT_JSON", async ({ nodeId }) => {
  const json = await extractComponentJSON(nodeId);
  return { json };
});
```

**Step 3: Add APPLY_COMPONENT_JSON handler**

```typescript
onRequestFromUI("APPLY_COMPONENT_JSON", async ({ nodeId, json }) => {
  const newNodeId = await applyComponentJSON(nodeId, json);
  return { success: true, nodeId: newNodeId };
});
```

**Step 4: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add figma-sync-plugin/src/sandbox/controller.ts
git commit -m "feat: add APPLY_COMPONENT_JSON and EXTRACT_COMPONENT_JSON handlers"
```

---

### Task 6: Update useSyncActions.ts — Component Sync Branches

**Files:**
- Modify: `figma-sync-plugin/src/ui/hooks/useSyncActions.ts`

**Step 1: Add ComponentDescriptor import**

```typescript
import type { ComponentDescriptor } from "../../shared/types";
```

**Step 2: Update handleForceSyncFigma for components**

Replace the component branch inside `handleForceSyncFigma` (the section that currently just updates hashes). For components, it should now: extract JSON → commit to GitHub.

In the `handleForceSyncFigma` function, replace the component handling section with:

```typescript
if (mapping.kind === "component") {
  setProgress("Extracting component JSON...");
  const { json } = await requestToPlugin("EXTRACT_COMPONENT_JSON", { nodeId: mapping.nodeId });

  setProgress("Committing to GitHub...");
  const jsonPath = `.figma/components/${mapping.componentName}.json`;
  const content = JSON.stringify(json, null, 2);

  let existingSha: string | undefined;
  try {
    const existing = await getFileContent(config.repoOwner, config.repoName, jsonPath, config.branch);
    existingSha = existing.sha;
  } catch {
    // File doesn't exist yet, that's fine
  }

  const { sha: newSha } = await updateFile({
    owner: config.repoOwner,
    repo: config.repoName,
    path: jsonPath,
    branch: config.branch,
    content,
    message: `sync: update ${mapping.componentName} component descriptor`,
    sha: existingSha,
  });

  setProgress("Updating hashes...");
  await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: mapping.nodeId });
  await requestToPlugin("UPDATE_CODE_HASH", { nodeId: mapping.nodeId, codeHash: newSha });
}
```

**Step 3: Update handleForceSyncCode for components**

Replace the component error section in `handleForceSyncCode` with actual pull logic:

```typescript
if (mapping.kind === "component") {
  setProgress("Reading component JSON from GitHub...");
  const jsonPath = `.figma/components/${mapping.componentName}.json`;
  const { content, sha } = await getFileContent(config.repoOwner, config.repoName, jsonPath, config.branch);

  const json: ComponentDescriptor = JSON.parse(content);

  setProgress("Applying to Figma...");
  const { nodeId: newNodeId } = await requestToPlugin("APPLY_COMPONENT_JSON", {
    nodeId: mapping.nodeId,
    json,
  });

  setProgress("Updating hashes...");
  // If nodeId changed (rebuild), update the mapping
  if (newNodeId !== mapping.nodeId) {
    await requestToPlugin("LINK_COMPONENT", { nodeId: newNodeId, codePath: mapping.linkedFile });
    await requestToPlugin("UNLINK_COMPONENT", { nodeId: mapping.nodeId });
  }
  await requestToPlugin("UPDATE_FIGMA_HASH", { nodeId: newNodeId });
  await requestToPlugin("UPDATE_CODE_HASH", { nodeId: newNodeId, codeHash: sha });
}
```

**Step 4: Remove handleCopyContext function entirely**

Delete the `handleCopyContext` function and remove it from the returned object.

**Step 5: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add figma-sync-plugin/src/ui/hooks/useSyncActions.ts
git commit -m "feat: wire component JSON sync into useSyncActions"
```

---

### Task 7: Update ComponentCard.tsx

**Files:**
- Modify: `figma-sync-plugin/src/ui/components/ComponentCard.tsx`

**Step 1: Remove Copy Context, enable Pull from Code for components**

Update the props interface — remove `onCopyContext`:

```typescript
interface ComponentCardProps {
  kind: "component" | "style" | "variable";
  componentName: string;
  state: SyncState;
  lastSyncedSnapshot?: FlatSnapshot;
  currentSnapshot?: FlatSnapshot;
  onForceSyncFigma: () => void;
  onForceSyncCode: () => void;
  onResolveConflict?: () => void;
  syncing: boolean;
  progressMessage?: string;
}
```

Update Col 1 (push button): Change label from "Mark Synced" to "Push to Code" for components (same as tokens now).

Update Col 3 (pull button): Replace the Copy Context conditional with "Pull from Code" for components — same as tokens:

```tsx
<button
  onClick={onForceSyncCode}
  disabled={!pullEnabled || syncing}
  className={...}
>
  Pull from Code
</button>
```

**Step 2: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add figma-sync-plugin/src/ui/components/ComponentCard.tsx
git commit -m "feat: enable Push/Pull for components, remove Copy Context"
```

---

### Task 8: Update MainView.tsx and ConflictView.tsx

**Files:**
- Modify: `figma-sync-plugin/src/ui/pages/MainView.tsx`
- Modify: `figma-sync-plugin/src/ui/pages/ConflictView.tsx`

**Step 1: Update MainView — remove onCopyContext prop**

In the mapping loop, remove `onCopyContext={...}` prop from ComponentCard. Pass `onForceSyncCode` for all kinds (not just tokens).

**Step 2: Update ConflictView — remove isComponent special case**

Change "Copy Context" button text to "Keep Code" for all types. Remove the `isComponent` prop. Both "Keep Figma" and "Keep Code" now work for components (Push JSON / Pull JSON).

**Step 3: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add figma-sync-plugin/src/ui/pages/MainView.tsx figma-sync-plugin/src/ui/pages/ConflictView.tsx
git commit -m "feat: unify component and token sync UI — remove Copy Context references"
```

---

### Task 9: Update useSync.ts — Component JSON Hash Tracking

**Files:**
- Modify: `figma-sync-plugin/src/ui/hooks/useSync.ts`

**Step 1: Update code hash fetching for components**

Currently `useSync.ts` fetches code hashes from the linked file path (e.g., `src/components/Button.tsx`). Components should ALSO track the JSON file hash (`.figma/components/Button.json`), since that's what the plugin reads/writes.

Update the hash fetching section to use the JSON path for components:

```typescript
// For components, track the JSON descriptor file hash
const hashPaths = updatedMappings.map((m) =>
  m.kind === "component"
    ? `.figma/components/${m.componentName}.json`
    : m.linkedFile
);
```

**Step 2: Verify**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add figma-sync-plugin/src/ui/hooks/useSync.ts
git commit -m "feat: track component JSON file hash for change detection"
```

---

### Task 10: Clean Up — Delete Obsolete Code

**Files:**
- Delete: `figma-sync-plugin/src/ui/lib/tailwindParser.ts` (if exists)
- Modify: `figma-sync-plugin/src/ui/lib/cssParser.ts` — remove any Tailwind-related exports (buildTailwindTokenMaps, etc.) if present

**Step 1: Delete tailwindParser.ts**

Run: `ls figma-sync-plugin/src/ui/lib/tailwindParser.ts`
If exists: `rm figma-sync-plugin/src/ui/lib/tailwindParser.ts`

**Step 2: Clean up any Tailwind references in cssParser.ts**

Remove `buildTailwindTokenMaps`, `cssColorToRgba`, `cssLengthToPx`, `TailwindTokenMaps` if they exist. Keep `parseCSSTokenFile` and its helpers (used by token sync).

**Step 3: Remove any remaining Copy Context references**

Search for "copyContext" or "handleCopyContext" in all files and remove dead code.

**Step 4: Verify**

Run: `cd figma-sync-plugin && npm run typecheck && npm run build`
Expected: Both PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove tailwindParser and Copy Context dead code"
```

---

### Task 11: Full Build Verification

**Step 1: Clean build**

Run: `cd figma-sync-plugin && rm -rf dist && npm run build`
Expected: Build completes successfully, `dist/code.js` and `dist/index.html` generated.

**Step 2: Typecheck both layers**

Run: `cd figma-sync-plugin && npm run typecheck`
Expected: Both sandbox and UI pass.

**Step 3: Final commit**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: resolve build issues from component descriptor implementation"
```
