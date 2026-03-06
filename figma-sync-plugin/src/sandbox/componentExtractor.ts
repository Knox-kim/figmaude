import type {
  ComponentDescriptor,
  ComponentDescriptorFill,
  ComponentDescriptorStroke,
  ComponentDescriptorEffect,
  ComponentDescriptorLayout,
  ComponentDescriptorStyles,
  ComponentDescriptorTextStyles,
  ComponentDescriptorChild,
  ComponentDescriptorProperty,
  ComponentDescriptorVariantOverride,
} from "../shared/types";
import { parseDescription, updateSyncNotes } from "../shared/descriptionParser";
import { isOnPage } from "./mapping";

// --- Helpers ---

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const hex = rgbToHex(r, g, b);
  const ca = clamp01(a);
  if (ca < 1) {
    const alphaHex = Math.round(ca * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${alphaHex}`;
  }
  return hex;
}

async function resolveVariableName(binding: VariableAlias): Promise<string | undefined> {
  try {
    const variable = await figma.variables.getVariableByIdAsync(binding.id);
    return variable?.name ?? undefined;
  } catch {
    return undefined;
  }
}

// --- Fill / Stroke / Effect extractors ---

async function extractFills(
  node: SceneNode,
  notes?: string[],
): Promise<ComponentDescriptorFill[] | undefined> {
  if (!("fills" in node)) return undefined;
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return undefined;

  const result: ComponentDescriptorFill[] = [];

  for (let i = 0; i < fills.length; i++) {
    const paint = fills[i];
    if (paint.type !== "SOLID") {
      if (paint.visible !== false && notes) {
        notes.push(`gradient/image fill on "${node.name}" skipped (SOLID only)`);
      }
      continue;
    }
    if (paint.visible === false) continue;

    const fill: ComponentDescriptorFill = {
      type: "SOLID",
      color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
    };
    if (paint.opacity !== undefined && paint.opacity < 1) {
      fill.opacity = paint.opacity;
    }

    // Check paint-level boundVariables (color → variable)
    if (paint.boundVariables?.color) {
      fill.boundVariable = await resolveVariableName(paint.boundVariables.color);
    }
    // Also check node-level boundVariables.fills array
    if (!fill.boundVariable && "boundVariables" in node) {
      const bv = (node as unknown as { boundVariables?: { fills?: VariableAlias[] } }).boundVariables;
      const fillBindings = bv?.fills;
      if (fillBindings && fillBindings[i]) {
        fill.boundVariable = await resolveVariableName(fillBindings[i]);
      }
    }

    result.push(fill);
  }

  return result.length > 0 ? result : undefined;
}

async function extractStrokes(
  node: SceneNode,
  notes?: string[],
): Promise<ComponentDescriptorStroke[] | undefined> {
  if (!("strokes" in node)) return undefined;
  const strokes = (node as MinimalStrokesMixin).strokes;
  if (!Array.isArray(strokes)) return undefined;

  const strokeWeight =
    "strokeWeight" in node
      ? (node as MinimalStrokesMixin).strokeWeight
      : undefined;
  const weight =
    strokeWeight !== undefined && strokeWeight !== figma.mixed
      ? strokeWeight
      : undefined;

  const result: ComponentDescriptorStroke[] = [];

  for (let i = 0; i < strokes.length; i++) {
    const paint = strokes[i];
    if (paint.type !== "SOLID") {
      if (paint.visible !== false && notes) {
        notes.push(`gradient stroke on "${node.name}" skipped (SOLID only)`);
      }
      continue;
    }
    if (paint.visible === false) continue;

    const stroke: ComponentDescriptorStroke = {
      type: "SOLID",
      color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
    };
    if (paint.opacity !== undefined && paint.opacity < 1) {
      stroke.opacity = paint.opacity;
    }
    if (weight !== undefined) {
      stroke.weight = weight;
    }
    if (paint.boundVariables?.color) {
      stroke.boundVariable = await resolveVariableName(paint.boundVariables.color);
    }

    // Stroke alignment (same for all strokes on a node)
    if ("strokeAlign" in node) {
      const align = (node as GeometryMixin).strokeAlign as "INSIDE" | "OUTSIDE" | "CENTER";
      if (align !== "CENTER") {
        stroke.align = align;
      }
    }

    result.push(stroke);
  }

  return result.length > 0 ? result : undefined;
}

function extractEffects(
  node: SceneNode
): ComponentDescriptorEffect[] | undefined {
  if (!("effects" in node)) return undefined;
  const effects = (node as BlendMixin).effects;
  if (!Array.isArray(effects) || effects.length === 0) return undefined;

  const result: ComponentDescriptorEffect[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;

    const desc: ComponentDescriptorEffect = {
      type: effect.type as ComponentDescriptorEffect["type"],
      radius: effect.radius,
    };

    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      const shadow = effect as DropShadowEffect | InnerShadowEffect;
      desc.color = rgbaToHex(
        shadow.color.r,
        shadow.color.g,
        shadow.color.b,
        shadow.color.a
      );
      desc.offset = { x: shadow.offset.x, y: shadow.offset.y };
      if (shadow.spread !== undefined && shadow.spread !== 0) {
        desc.spread = shadow.spread;
      }
    }

    result.push(desc);
  }

  return result.length > 0 ? result : undefined;
}

// --- Layout ---

async function extractLayout(
  node: SceneNode,
  notes?: string[],
): Promise<ComponentDescriptorLayout | undefined> {
  if (!("layoutMode" in node)) return undefined;
  const frame = node as FrameNode;

  if (frame.layoutMode === "NONE") return undefined;

  const layout: ComponentDescriptorLayout = {
    mode: frame.layoutMode as "HORIZONTAL" | "VERTICAL",
  };

  const padding = {
    top: frame.paddingTop,
    right: frame.paddingRight,
    bottom: frame.paddingBottom,
    left: frame.paddingLeft,
  };
  if (padding.top || padding.right || padding.bottom || padding.left) {
    layout.padding = padding;
  }

  if (frame.itemSpacing !== undefined) {
    layout.itemSpacing = frame.itemSpacing;
  }

  layout.primaryAxisAlign = frame.primaryAxisAlignItems;
  // BASELINE is a valid Figma value but not in our descriptor type — map to MIN
  const counterAlign = frame.counterAxisAlignItems;
  if (counterAlign === "BASELINE" && notes) {
    notes.push(`BASELINE alignment on "${node.name}" mapped to MIN`);
  }
  layout.counterAxisAlign = counterAlign === "BASELINE" ? "MIN" : counterAlign;
  layout.primaryAxisSizing = frame.primaryAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";
  layout.counterAxisSizing = frame.counterAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";

  // Extract layout variable bindings
  const bv = frame.boundVariables;
  if (bv) {
    const layoutBV: NonNullable<ComponentDescriptorLayout["boundVariables"]> = {};
    const fields = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "itemSpacing", "counterAxisSpacing"] as const;
    for (const field of fields) {
      const binding = bv[field];
      if (binding) {
        const name = await resolveVariableName(binding as VariableAlias);
        if (name) layoutBV[field] = name;
      }
    }
    if (Object.keys(layoutBV).length > 0) {
      layout.boundVariables = layoutBV;
    }
  }

  return layout;
}

// --- Styles (combines fills, strokes, effects, cornerRadius, size) ---

async function extractStyles(
  node: SceneNode,
  notes?: string[],
): Promise<ComponentDescriptorStyles | undefined> {
  const fills = await extractFills(node, notes);
  const strokes = await extractStrokes(node, notes);
  const effects = extractEffects(node);

  // Capture PaintStyle / EffectStyle references (node-level style bindings)
  let fillStyleRef: string | undefined;
  if ("fillStyleId" in node) {
    const fsId = (node as GeometryMixin).fillStyleId;
    if (fsId && fsId !== figma.mixed && typeof fsId === "string") {
      const style = await figma.getStyleByIdAsync(fsId);
      if (style) fillStyleRef = style.name;
    }
  }
  let strokeStyleRef: string | undefined;
  if ("strokeStyleId" in node) {
    const ssId = (node as GeometryMixin).strokeStyleId;
    if (ssId && ssId !== figma.mixed && typeof ssId === "string") {
      const style = await figma.getStyleByIdAsync(ssId);
      if (style) strokeStyleRef = style.name;
    }
  }
  let effectStyleRef: string | undefined;
  if ("effectStyleId" in node) {
    const esId = (node as BlendMixin).effectStyleId;
    if (esId && typeof esId === "string") {
      const style = await figma.getStyleByIdAsync(esId);
      if (style) effectStyleRef = style.name;
    }
  }

  let cornerRadius: ComponentDescriptorStyles["cornerRadius"] | undefined;
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr === figma.mixed) {
      const rect = node as RectangleNode;
      cornerRadius = {
        topLeft: rect.topLeftRadius,
        topRight: rect.topRightRadius,
        bottomLeft: rect.bottomLeftRadius,
        bottomRight: rect.bottomRightRadius,
      };
    } else if (cr > 0) {
      cornerRadius = cr;
    }
  }

  const styles: ComponentDescriptorStyles = {};
  if (fillStyleRef) styles.fillStyleRef = fillStyleRef;
  if (strokeStyleRef) styles.strokeStyleRef = strokeStyleRef;
  if (effectStyleRef) styles.effectStyleRef = effectStyleRef;
  if (fills) styles.fills = fills;
  if (strokes) styles.strokes = strokes;
  if (effects) styles.effects = effects;
  if (cornerRadius !== undefined) styles.cornerRadius = cornerRadius;
  styles.width = Math.round(node.width);
  styles.height = Math.round(node.height);

  if ("layoutSizingHorizontal" in node) {
    const frame = node as FrameNode;
    styles.layoutSizingHorizontal = frame.layoutSizingHorizontal;
    styles.layoutSizingVertical = frame.layoutSizingVertical;
  }

  if ("opacity" in node && (node as BlendMixin).opacity < 1) {
    styles.opacity = (node as BlendMixin).opacity;
  }

  // Extract style variable bindings
  if ("boundVariables" in node) {
    const bv = (node as SceneNode & { boundVariables?: Record<string, VariableAlias> }).boundVariables;
    if (bv) {
      const stylesBV: NonNullable<ComponentDescriptorStyles["boundVariables"]> = {};
      const fields = ["width", "height", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius", "opacity"] as const;
      for (const field of fields) {
        const binding = bv[field as string];
        if (binding) {
          const name = await resolveVariableName(binding as VariableAlias);
          if (name) stylesBV[field] = name;
        }
      }
      if (Object.keys(stylesBV).length > 0) {
        styles.boundVariables = stylesBV;
      }
    }
  }

  return Object.keys(styles).length > 0 ? styles : undefined;
}

// --- Text styles ---

async function extractTextStyles(
  node: TextNode
): Promise<ComponentDescriptorTextStyles | undefined> {
  const ts: ComponentDescriptorTextStyles = {};

  // Capture TextStyle reference if bound (e.g. "t14")
  const textStyleId = node.textStyleId;
  if (textStyleId && textStyleId !== figma.mixed && typeof textStyleId === "string") {
    const style = await figma.getStyleByIdAsync(textStyleId);
    if (style) {
      ts.textStyleRef = style.name;
    }
  }

  const fontSize = node.fontSize;
  if (fontSize !== figma.mixed) {
    ts.fontSize = fontSize;
  }

  const fontName = node.fontName;
  if (fontName !== figma.mixed) {
    ts.fontFamily = fontName.family;
    // Convert font style string to numeric weight approximation
    ts.fontWeight = fontStyleToWeight(fontName.style);
  }

  const lineHeight = node.lineHeight;
  if (lineHeight !== figma.mixed) {
    if (lineHeight.unit === "AUTO") {
      ts.lineHeight = { value: 0, unit: "AUTO" };
    } else if (lineHeight.unit === "PIXELS") {
      ts.lineHeight = { value: lineHeight.value, unit: "PIXELS" };
    } else if (lineHeight.unit === "PERCENT") {
      ts.lineHeight = { value: lineHeight.value, unit: "PERCENT" };
    }
  }

  const letterSpacing = node.letterSpacing;
  if (letterSpacing !== figma.mixed && letterSpacing.value !== 0) {
    if (letterSpacing.unit === "PERCENT") {
      ts.letterSpacing = { value: letterSpacing.value, unit: "PERCENT" };
    } else {
      ts.letterSpacing = letterSpacing.value;
    }
  }

  ts.textAlignHorizontal = node.textAlignHorizontal;
  ts.textAutoResize = node.textAutoResize;

  // Text fills
  const fills = node.fills;
  if (fills !== figma.mixed && Array.isArray(fills)) {
    const textFills: ComponentDescriptorFill[] = [];
    for (const paint of fills) {
      if (paint.type === "SOLID" && paint.visible !== false) {
        const fill: ComponentDescriptorFill = {
          type: "SOLID",
          color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
        };
        if (paint.opacity !== undefined && paint.opacity < 1) {
          fill.opacity = paint.opacity;
        }
        if (paint.boundVariables?.color) {
          fill.boundVariable = await resolveVariableName(paint.boundVariables.color);
        }
        textFills.push(fill);
      }
    }
    if (textFills.length > 0) {
      ts.fills = textFills;
    }
  }

  return Object.keys(ts).length > 0 ? ts : undefined;
}

function fontStyleToWeight(style: string): number {
  const map: Record<string, number> = {
    Thin: 100,
    "Extra Light": 200,
    ExtraLight: 200,
    Light: 300,
    Regular: 400,
    Medium: 500,
    "Semi Bold": 600,
    SemiBold: 600,
    Bold: 700,
    "Extra Bold": 800,
    ExtraBold: 800,
    Black: 900,
  };
  // Handle compound styles like "Bold Italic"
  for (const [key, weight] of Object.entries(map)) {
    if (style.includes(key)) return weight;
  }
  return 400;
}

// --- Children ---

async function extractChild(
  node: SceneNode,
  notes?: string[],
): Promise<ComponentDescriptorChild | null> {
  const supportedTypes = ["FRAME", "TEXT", "INSTANCE", "RECTANGLE", "ELLIPSE", "VECTOR", "POLYGON", "STAR", "LINE"];
  if (!supportedTypes.includes(node.type)) return null;
  if ("blendMode" in node && notes) {
    const mode = (node as BlendMixin).blendMode;
    if (mode !== "NORMAL" && mode !== "PASS_THROUGH") {
      notes.push(`blendMode ${mode} on "${node.name}" not preserved`);
    }
  }

  const child: ComponentDescriptorChild = {
    type: node.type as ComponentDescriptorChild["type"],
    name: node.name,
  };

  // Shape-specific data extraction
  if (node.type === "POLYGON") {
    const poly = node as PolygonNode;
    child.pointCount = poly.pointCount;
  } else if (node.type === "STAR") {
    const star = node as StarNode;
    child.pointCount = star.pointCount;
    child.innerRadius = star.innerRadius;
  } else if (node.type === "VECTOR") {
    try {
      const vnode = node as VectorNode;
      if (vnode.vectorPaths && vnode.vectorPaths.length > 0) {
        child.vectorPaths = vnode.vectorPaths.map((vp) => ({
          windingRule: vp.windingRule,
          data: vp.data,
        }));
      } else if (notes) {
        notes.push(`VECTOR "${node.name}" has no vectorPaths, will become placeholder RECTANGLE`);
      }
    } catch {
      if (notes) {
        notes.push(`VECTOR "${node.name}" vectorPaths extraction failed, will become placeholder RECTANGLE`);
      }
    }
  }

  // Extract rotation (applies to all shape nodes)
  if ("rotation" in node) {
    const rot = (node as SceneNode & { rotation: number }).rotation;
    if (rot !== 0) {
      child.rotation = rot;
    }
  }

  // Instance: resolve componentRef
  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    const mainComponent = await instance.getMainComponentAsync();
    if (mainComponent) {
      if (mainComponent.parent?.type === "COMPONENT_SET") {
        child.componentRef = mainComponent.parent.name;
      } else {
        child.componentRef = mainComponent.name;
      }
    } else {
      // Fallback: use instance name as componentRef so builder can resolve by name
      child.componentRef = node.name;
      if (notes) {
        notes.push(`instance "${node.name}" main component not found, using name as ref`);
      }
    }
    // Note: instance overrides (property values) are not captured
    if (notes && Object.keys(instance.componentProperties ?? {}).length > 0) {
      notes.push(`instance "${node.name}" overrides not captured (defaults only)`);
    }
  }

  // Layout (for frame-like nodes)
  if ("layoutMode" in node) {
    child.layout = await extractLayout(node, notes);
  }

  // Styles
  child.styles = await extractStyles(node, notes);

  // Text-specific
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    child.textStyles = await extractTextStyles(textNode);
    child.textContent = textNode.characters;

    // Check if text is bound to a component property (bindTo)
    if (textNode.componentPropertyReferences) {
      const charRef = textNode.componentPropertyReferences.characters;
      if (charRef) {
        child.bindTo = stripPropertyHash(charRef);
      }
    }
  }

  // Check if visibility is bound to a BOOLEAN component property
  if ("componentPropertyReferences" in node) {
    const refs = (node as SceneNode & { componentPropertyReferences?: Record<string, string> }).componentPropertyReferences;
    if (refs?.visible) {
      child.visibleBindTo = stripPropertyHash(refs.visible);
    }
  }

  // Recurse into children for frame-like nodes
  if ("children" in node && node.type !== "INSTANCE") {
    const frame = node as FrameNode;
    const childNodes: ComponentDescriptorChild[] = [];
    for (const c of frame.children) {
      const extracted = await extractChild(c, notes);
      if (extracted) childNodes.push(extracted);
    }
    if (childNodes.length > 0) {
      child.children = childNodes;
    }
  }

  return child;
}

// --- Properties ---

function extractProperties(
  node: ComponentNode | ComponentSetNode
): ComponentDescriptorProperty[] | undefined {
  let defs: ComponentPropertyDefinitions | null = null;
  try {
    defs = node.componentPropertyDefinitions;
  } catch {
    // ComponentSet with validation errors (e.g. conflicting variants) throws here.
    // Fall through — we'll infer VARIANT properties from children names below.
  }

  const result: ComponentDescriptorProperty[] = [];

  // If defs failed but this is a ComponentSet, infer VARIANT properties from children
  if (!defs && node.type === "COMPONENT_SET") {
    const propValuesMap = new Map<string, Set<string>>();
    for (const child of (node as ComponentSetNode).children) {
      if (child.type !== "COMPONENT") continue;
      for (const part of child.name.split(",").map((s) => s.trim())) {
        const eqIdx = part.indexOf("=");
        if (eqIdx >= 0) {
          const key = part.slice(0, eqIdx).trim();
          const value = part.slice(eqIdx + 1).trim();
          if (!propValuesMap.has(key)) propValuesMap.set(key, new Set());
          propValuesMap.get(key)!.add(value);
        }
      }
    }
    for (const [name, values] of propValuesMap) {
      const options = [...values];
      result.push({
        name,
        type: "VARIANT",
        options,
        default: options[0],
      });
    }
    return result.length > 0 ? result : undefined;
  }

  if (!defs || Object.keys(defs).length === 0) return undefined;

  for (const [key, def] of Object.entries(defs)) {
    const name = stripPropertyHash(key);

    const prop: ComponentDescriptorProperty = {
      name,
      type: def.type as ComponentDescriptorProperty["type"],
      default: def.defaultValue,
    };

    if (def.type === "VARIANT" && def.variantOptions) {
      prop.options = def.variantOptions;
    }

    result.push(prop);
  }

  return result.length > 0 ? result : undefined;
}

function stripPropertyHash(key: string): string {
  const hashIdx = key.indexOf("#");
  return hashIdx >= 0 ? key.slice(0, hashIdx) : key;
}

// --- Variants ---

async function extractVariants(
  componentSet: ComponentSetNode
): Promise<ComponentDescriptorVariantOverride[] | undefined> {
  const children = componentSet.children as ComponentNode[];
  if (children.length < 2) return undefined;

  const baseVariant = componentSet.defaultVariant;
  const baseStyles = await extractStyles(baseVariant);
  const baseLayout = await extractLayout(baseVariant);
  const baseChildren = await extractChildMap(baseVariant);

  const overrides: ComponentDescriptorVariantOverride[] = [];

  for (const variant of children) {
    if (variant.id === baseVariant.id) continue;

    try {
      const props = parseVariantName(variant.name);
      const variantStyles = await extractStyles(variant);
      const variantLayout = await extractLayout(variant);
      const variantChildren = await extractChildMap(variant);

      const override: ComponentDescriptorVariantOverride = {
        props,
        overrides: {},
      };

      // Diff styles
      const styleDiff = diffStyles(baseStyles, variantStyles);
      if (styleDiff) override.overrides.styles = styleDiff;

      // Diff layout
      const layoutDiff = diffLayout(baseLayout, variantLayout);
      if (layoutDiff) override.overrides.layout = layoutDiff;

      // Diff children
      const childDiff = diffChildren(baseChildren, variantChildren);
      if (childDiff) {
        if (childDiff.modified) override.overrides.children = childDiff.modified;
        if (childDiff.childOrder) override.overrides.childOrder = childDiff.childOrder;
        if (childDiff.removedNames) override.overrides.removedChildren = childDiff.removedNames;

        // Extract full child definitions for children added in this variant
        if (childDiff.addedNames) {
          const added: ComponentDescriptorChild[] = [];
          if ("children" in variant) {
            for (const child of (variant as FrameNode).children) {
              if (childDiff.addedNames.includes(child.name)) {
                const extracted = await extractChild(child);
                if (extracted) added.push(extracted);
              }
            }
          }
          if (added.length > 0) override.overrides.addedChildren = added;
        }
      }

      // Always include — even if no visual overrides, the variant's props
      // (e.g., Size=lg) define a distinct variant that must exist.
      overrides.push(override);
    } catch (err) {
      // Skip this variant but continue extracting the rest
      console.error(`Failed to extract variant "${variant.name}":`, err);
      // Still include the variant with empty overrides so it's not lost
      overrides.push({
        props: parseVariantName(variant.name),
        overrides: {},
      });
    }
  }

  return overrides.length > 0 ? overrides : undefined;
}

function parseVariantName(name: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = name.split(",").map((s) => s.trim());
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx >= 0) {
      const key = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

interface ChildSnapshot {
  styles?: ComponentDescriptorStyles;
  textStyles?: ComponentDescriptorTextStyles;
  textContent?: string;
  rotation?: number;
  vectorPaths?: Array<{ windingRule: "EVENODD" | "NONZERO"; data: string }>;
}

async function extractChildMap(
  node: SceneNode
): Promise<Map<string, ChildSnapshot>> {
  const map = new Map<string, ChildSnapshot>();
  if (!("children" in node)) return map;
  const frame = node as FrameNode;
  for (const child of frame.children) {
    const snapshot: ChildSnapshot = {
      styles: await extractStyles(child),
    };
    if (child.type === "TEXT") {
      const textNode = child as TextNode;
      snapshot.textStyles = await extractTextStyles(textNode);
      snapshot.textContent = textNode.characters;
    }
    if ("rotation" in child) {
      const rot = (child as SceneNode & { rotation: number }).rotation;
      if (rot !== 0) snapshot.rotation = rot;
    }
    if (child.type === "VECTOR") {
      try {
        const vnode = child as VectorNode;
        if (vnode.vectorPaths && vnode.vectorPaths.length > 0) {
          snapshot.vectorPaths = vnode.vectorPaths.map((vp) => ({
            windingRule: vp.windingRule,
            data: vp.data,
          }));
        }
      } catch { /* ignore */ }
    }
    map.set(child.name, snapshot);
  }
  return map;
}

function diffStyles(
  base: ComponentDescriptorStyles | undefined,
  variant: ComponentDescriptorStyles | undefined
): Partial<ComponentDescriptorStyles> | undefined {
  if (!variant) return undefined;
  if (!base) return variant;

  const diff: Partial<ComponentDescriptorStyles> = {};
  let hasDiff = false;

  if (JSON.stringify(variant.fills) !== JSON.stringify(base.fills)) {
    diff.fills = variant.fills;
    hasDiff = true;
  }
  if (JSON.stringify(variant.strokes) !== JSON.stringify(base.strokes)) {
    diff.strokes = variant.strokes;
    hasDiff = true;
  }
  if (JSON.stringify(variant.effects) !== JSON.stringify(base.effects)) {
    diff.effects = variant.effects;
    hasDiff = true;
  }
  if (JSON.stringify(variant.cornerRadius) !== JSON.stringify(base.cornerRadius)) {
    diff.cornerRadius = variant.cornerRadius;
    hasDiff = true;
  }
  if (variant.width !== base.width) {
    diff.width = variant.width;
    hasDiff = true;
  }
  if (variant.height !== base.height) {
    diff.height = variant.height;
    hasDiff = true;
  }

  return hasDiff ? diff : undefined;
}

function diffLayout(
  base: ComponentDescriptorLayout | undefined,
  variant: ComponentDescriptorLayout | undefined
): Partial<ComponentDescriptorLayout> | undefined {
  if (!variant) return undefined;
  if (!base) return variant;

  if (JSON.stringify(base) === JSON.stringify(variant)) return undefined;

  const diff: Partial<ComponentDescriptorLayout> = {};
  let hasDiff = false;

  if (variant.mode !== base.mode) {
    diff.mode = variant.mode;
    hasDiff = true;
  }
  if (JSON.stringify(variant.padding) !== JSON.stringify(base.padding)) {
    diff.padding = variant.padding;
    hasDiff = true;
  }
  if (variant.itemSpacing !== base.itemSpacing) {
    diff.itemSpacing = variant.itemSpacing;
    hasDiff = true;
  }
  if (variant.primaryAxisAlign !== base.primaryAxisAlign) {
    diff.primaryAxisAlign = variant.primaryAxisAlign;
    hasDiff = true;
  }
  if (variant.counterAxisAlign !== base.counterAxisAlign) {
    diff.counterAxisAlign = variant.counterAxisAlign;
    hasDiff = true;
  }

  return hasDiff ? diff : undefined;
}

interface ChildDiffResult {
  modified?: Record<string, {
    styles?: Partial<ComponentDescriptorStyles>;
    textStyles?: Partial<ComponentDescriptorTextStyles>;
    textContent?: string;
    rotation?: number;
    vectorPaths?: Array<{ windingRule: "EVENODD" | "NONZERO"; data: string }>;
  }>;
  childOrder?: string[];
  addedNames?: string[];
  removedNames?: string[];
}

function diffChildren(
  base: Map<string, ChildSnapshot>,
  variant: Map<string, ChildSnapshot>
): ChildDiffResult | undefined {
  const modified: Record<string, {
    styles?: Partial<ComponentDescriptorStyles>;
    textStyles?: Partial<ComponentDescriptorTextStyles>;
    textContent?: string;
    rotation?: number;
    vectorPaths?: Array<{ windingRule: "EVENODD" | "NONZERO"; data: string }>;
  }> = {};
  let hasDiff = false;

  const addedNames: string[] = [];
  const removedNames: string[] = [];

  for (const [name, variantChild] of variant.entries()) {
    const baseChild = base.get(name);
    if (!baseChild) {
      // Child exists in variant but not in base
      addedNames.push(name);
      hasDiff = true;
      continue;
    }

    const childOverride: {
      styles?: Partial<ComponentDescriptorStyles>;
      textStyles?: Partial<ComponentDescriptorTextStyles>;
      textContent?: string;
      rotation?: number;
      vectorPaths?: Array<{ windingRule: "EVENODD" | "NONZERO"; data: string }>;
    } = {};
    let childHasDiff = false;

    const styleDiff = diffStyles(baseChild.styles, variantChild.styles);
    if (styleDiff) {
      childOverride.styles = styleDiff;
      childHasDiff = true;
    }

    if (
      JSON.stringify(variantChild.textStyles) !==
      JSON.stringify(baseChild.textStyles)
    ) {
      childOverride.textStyles = variantChild.textStyles;
      childHasDiff = true;
    }

    if (variantChild.textContent !== baseChild.textContent) {
      childOverride.textContent = variantChild.textContent;
      childHasDiff = true;
    }

    if (variantChild.rotation !== baseChild.rotation) {
      childOverride.rotation = variantChild.rotation ?? 0;
      childHasDiff = true;
    }

    if (JSON.stringify(variantChild.vectorPaths) !== JSON.stringify(baseChild.vectorPaths)) {
      childOverride.vectorPaths = variantChild.vectorPaths;
      childHasDiff = true;
    }

    if (childHasDiff) {
      modified[name] = childOverride;
      hasDiff = true;
    }
  }

  // Children in base but not in variant
  for (const name of base.keys()) {
    if (!variant.has(name)) {
      removedNames.push(name);
      hasDiff = true;
    }
  }

  // Compare children order
  const baseOrder = [...base.keys()];
  const variantOrder = [...variant.keys()];
  let childOrder: string[] | undefined;
  if (JSON.stringify(baseOrder) !== JSON.stringify(variantOrder)) {
    childOrder = variantOrder;
    hasDiff = true;
  }

  if (!hasDiff) return undefined;

  return {
    modified: Object.keys(modified).length > 0 ? modified : undefined,
    childOrder,
    addedNames: addedNames.length > 0 ? addedNames : undefined,
    removedNames: removedNames.length > 0 ? removedNames : undefined,
  };
}

// --- Main export ---

export async function extractComponentJSON(
  nodeId: string
): Promise<ComponentDescriptor> {
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node || node.removed || !isOnPage(node)) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(
      `Node ${nodeId} is type "${node.type}", expected COMPONENT or COMPONENT_SET`
    );
  }

  const syncNotes: string[] = [];

  const descriptor: ComponentDescriptor = {
    $schema: "figma-sync/component-descriptor@1",
    name: node.name,
  };

  if (node.description) {
    const parsed = parseDescription(node.description);
    if (parsed.plainDescription) {
      descriptor.description = parsed.plainDescription;
    }
    if (Object.keys(parsed.annotations).length > 0) {
      descriptor.annotations = parsed.annotations;
    }
  }

  // Properties
  descriptor.properties = extractProperties(node);

  if (node.type === "COMPONENT_SET") {
    // For component sets, extract from the default variant (base)
    const baseVariant = node.defaultVariant;

    // Sync VARIANT defaults to match the actual default variant's values,
    // so the builder names the base variant correctly.
    if (descriptor.properties) {
      const basePropValues = parseVariantName(baseVariant.name);
      for (const prop of descriptor.properties) {
        if (prop.type === "VARIANT" && basePropValues[prop.name] !== undefined) {
          prop.default = basePropValues[prop.name];
        }
      }
    }
    descriptor.layout = await extractLayout(baseVariant, syncNotes);
    descriptor.styles = await extractStyles(baseVariant, syncNotes);

    // Extract children from base variant
    const children: ComponentDescriptorChild[] = [];
    if ("children" in baseVariant) {
      for (const child of baseVariant.children) {
        const extracted = await extractChild(child, syncNotes);
        if (extracted) children.push(extracted);
      }
    }
    if (children.length > 0) {
      descriptor.children = children;
    }

    // Extract variant overrides
    descriptor.variants = await extractVariants(node);
  } else {
    // Single component
    descriptor.layout = await extractLayout(node, syncNotes);
    descriptor.styles = await extractStyles(node, syncNotes);

    // Extract children
    const children: ComponentDescriptorChild[] = [];
    for (const child of node.children) {
      const extracted = await extractChild(child, syncNotes);
      if (extracted) children.push(extracted);
    }
    if (children.length > 0) {
      descriptor.children = children;
    }
  }

  // Store syncNotes in descriptor and update Figma description
  if (syncNotes.length > 0) {
    descriptor.syncNotes = syncNotes;
    node.description = updateSyncNotes(node.description ?? "", syncNotes);
  }

  return descriptor;
}
